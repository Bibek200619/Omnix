from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

from ..services.supabase_service import (
    SupabaseServiceError,
    check_infrastructure_pressure,
    insert_one_trusted,
    select_all_trusted,
    upsert_one,
)
from .workspace_service import (
    get_profiles,
    list_user_workspaces,
    normalize_ai_specialization,
    normalize_workspace_focus,
    normalize_workspace_record,
    require_workspace_access,
    utc_now_iso,
)
from ..bootstrap.redis import get_redis
import json

logger = logging.getLogger(__name__)

import time

# Redis Key Constants
# omnix:presence:{workspace_id}:{user_id} -> live per-user presence snapshot (JSON) with TTL
# presence:{workspace_id} -> derived workspace presence snapshot cache (JSON) with short TTL
# status:{user_id} -> live status snapshot (JSON) with TTL
# cooldown:{workspace_id}:{user_id}:{action} -> dummy value with TTL
PRESENCE_ENTRY_KEY_PREFIX = "omnix:presence"
PRESENCE_KEY_PREFIX = "presence"
STATUS_KEY_PREFIX = "status"
COOLDOWN_KEY_PREFIX = "cooldown"

HEARTBEAT_INTERVAL_MS = 60_000
HEARTBEAT_TTL = int((HEARTBEAT_INTERVAL_MS / 1000) * 2.5)
STATUS_TTL = 30           # Seconds for live status cache to expire
COOLDOWN_HEARTBEAT = 60    # Seconds between actual DB writes for heartbeats
COOLDOWN_TYPING = 5       # Seconds between actual DB writes for typing

SNAPSHOT_CACHE_TTL = 10.0  # Seconds to cache presence snapshots (ephemeral local optimization)
_local_snapshot_cache: dict[str, tuple[float, dict[str, Any]]] = {}

PRESENCE_COLUMNS = (
    "workspace_id,user_id,status,current_view,current_label,typing_until,"
    "typing_conversation_id,metadata,last_seen_at,created_at,updated_at"
)
ACTIVITY_COLUMNS = "id,workspace_id,actor_user_id,event_type,summary,metadata,created_at"
FILE_STATUS_COLUMNS = "id,workspace_id"

ONLINE_WINDOW = timedelta(seconds=HEARTBEAT_TTL)
RECENT_WINDOW = timedelta(minutes=30)
TYPING_WINDOW = timedelta(seconds=8)
STATUS_ACTIVITY_LIMIT = 250
STATUS_SOURCE_LIMIT = 1000
STATUS_PRESENCE_LIMIT = 1000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _clean_text(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    if not text:
        return None
    return text[:limit]


def _presence_entry_key(workspace_id: str, user_id: str) -> str:
    return f"{PRESENCE_ENTRY_KEY_PREFIX}:{workspace_id}:{user_id}"


def _presence_entry_pattern(workspace_id: str) -> str:
    return f"{PRESENCE_ENTRY_KEY_PREFIX}:{workspace_id}:*"


def _presence_snapshot_key(workspace_id: str) -> str:
    return f"{PRESENCE_KEY_PREFIX}:{workspace_id}"


def _redis_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


async def _scan_redis_keys(redis: Any, pattern: str) -> list[str]:
    scan_iter = getattr(redis, "scan_iter", None)
    if callable(scan_iter):
        iterator = scan_iter(match=pattern)
        keys: list[str] = []
        if hasattr(iterator, "__aiter__"):
            async for key in iterator:
                keys.append(_redis_text(key))
        else:
            keys.extend(_redis_text(key) for key in iterator)
        return keys

    keys_method = getattr(redis, "keys", None)
    if callable(keys_method):
        keys = await keys_method(pattern)
        return [_redis_text(key) for key in keys]

    return []


async def _redis_presence_rows(redis: Any, workspace_id: str) -> list[dict[str, Any]] | None:
    try:
        keys = await _scan_redis_keys(redis, _presence_entry_pattern(workspace_id))
        rows: list[dict[str, Any]] = []
        for key in keys:
            raw = await redis.get(key)
            if not raw:
                continue
            try:
                payload = json.loads(_redis_text(raw))
            except (TypeError, ValueError):
                continue
            if not isinstance(payload, dict):
                continue
            if str(payload.get("workspace_id") or "") != workspace_id or not payload.get("user_id"):
                continue
            rows.append(payload)
        return rows
    except Exception:
        logger.error("Redis fetch failed for live workspace presence", exc_info=True)
        return None


async def _presence_result_from_rows(
    *,
    workspace_id: str,
    rows: list[dict[str, Any]],
    now: datetime,
) -> dict[str, Any]:
    profiles = await get_profiles([str(row.get("user_id") or "") for row in rows])
    members = _sort_presence_members(
        [
            _presence_member_payload(row, profiles.get(str(row.get("user_id") or ""), {}), now)
            for row in rows
            if row.get("user_id")
        ]
    )
    online_members = [member for member in members if member["status"] == "online"]
    recently_active_members = [member for member in members if member["status"] in {"online", "recent"}]

    return {
        "workspace_id": workspace_id,
        "online_count": len(online_members),
        "active_count": len(online_members),
        "recently_active_count": len(recently_active_members),
        "typing_count": 0,
        "online_members": online_members,
        "active_members": online_members,
        "recently_active_members": recently_active_members,
        "typing_members": [],
        "updated_at": now.isoformat(),
    }


async def _cache_presence_result(redis: Any, workspace_id: str, now_ts: float, result: dict[str, Any]) -> None:
    try:
        await redis.setex(_presence_snapshot_key(workspace_id), int(SNAPSHOT_CACHE_TTL), json.dumps(result))
    except Exception:
        logger.error("Failed to update presence snapshot in Redis")
    _local_snapshot_cache[workspace_id] = (now_ts, result)


async def _refresh_redis_presence(redis: Any, payload: dict[str, Any]) -> None:
    workspace_id = str(payload.get("workspace_id") or "")
    user_id = str(payload.get("user_id") or "")
    if not workspace_id or not user_id:
        return

    await redis.setex(_presence_entry_key(workspace_id, user_id), HEARTBEAT_TTL, json.dumps(payload))
    try:
        await redis.delete(_presence_snapshot_key(workspace_id), f"{STATUS_KEY_PREFIX}:{user_id}")
    finally:
        _local_snapshot_cache.pop(workspace_id, None)


def _profile_avatar_label(profile: Mapping[str, Any], user_id: str) -> str:
    for key in ("full_name", "email", "handle"):
        value = profile.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[0].upper()
    return user_id[:1].upper() or "U"


def _presence_status(row: Mapping[str, Any], now: datetime) -> str:
    last_seen_at = _parse_dt(row.get("last_seen_at"))
    if last_seen_at is None:
        return "offline"
    if now - last_seen_at <= ONLINE_WINDOW:
        return "online"
    if now - last_seen_at <= RECENT_WINDOW:
        return "recent"
    return "offline"


def _presence_member_payload(
    row: Mapping[str, Any],
    profile: Mapping[str, Any],
    now: datetime,
) -> dict[str, Any]:
    user_id = str(row.get("user_id") or "")
    status = _presence_status(row, now)
    return {
        "workspace_id": str(row.get("workspace_id") or ""),
        "user_id": user_id,
        "status": status,
        "current_view": row.get("current_view"),
        "current_label": row.get("current_label"),
        "is_online": status == "online",
        "is_typing": False,
        "typing_conversation_id": None,
        "last_seen_at": row.get("last_seen_at"),
        "updated_at": row.get("updated_at"),
        "email": profile.get("email"),
        "full_name": profile.get("full_name"),
        "handle": profile.get("handle"),
        "avatar_url": profile.get("avatar_url"),
        "avatar_label": profile.get("avatar_label") or _profile_avatar_label(profile, user_id),
    }


def _sort_presence_members(members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return sorted(
        members,
        key=lambda item: (
            {"online": 0, "recent": 1, "offline": 2}.get(str(item.get("status")), 3),
            -(_parse_dt(item.get("last_seen_at")) or epoch).timestamp(),
            (item.get("full_name") or item.get("email") or item.get("user_id") or "").lower(),
        ),
    )


async def heartbeat_workspace_presence(
    *,
    workspace_id: str,
    user_id: str,
    current_view: str | None = None,
    current_label: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    
    redis = get_redis()
    now_ts = time.perf_counter()

    timestamp = utc_now_iso()
    payload = {
        "workspace_id": workspace_id,
        "user_id": user_id,
        "status": "online",
        "current_view": _clean_text(current_view, 80),
        "current_label": _clean_text(current_label, 255),
        "metadata": dict(metadata or {}),
        "last_seen_at": timestamp,
        "updated_at": timestamp,
    }

    try:
        await _refresh_redis_presence(redis, payload)
    except Exception:
        logger.error("Failed to refresh Redis workspace presence TTL", exc_info=True)

    # Check if we should write to Postgres (cooldown).
    # We use Redis for global cooldown across all workers, but the live Redis
    # presence key above is always refreshed so closed browsers expire by TTL.
    cooldown_key = f"{COOLDOWN_KEY_PREFIX}:{workspace_id}:{user_id}:heartbeat"
    on_cooldown = await redis.get(cooldown_key)

    # Graceful degradation: decrease cooldown if infrastructure is under pressure
    effective_cooldown = COOLDOWN_HEARTBEAT * 2 if check_infrastructure_pressure() else COOLDOWN_HEARTBEAT

    # If within cooldown, return cached snapshot or fresh list
    if on_cooldown:
        cached = _local_snapshot_cache.get(workspace_id)
        if cached and (now_ts - cached[0] < SNAPSHOT_CACHE_TTL):
            return cached[1]
        return await list_workspace_presence(workspace_id=workspace_id, user_id=user_id)

    try:
        # Write to Postgres for persistent authority
        await upsert_one("workspace_presence", payload, on_conflict="workspace_id,user_id")
        
        # Set global cooldown in Redis
        await redis.setex(cooldown_key, effective_cooldown, "1")
        
        # Invalidate local caches across all workers isn't easy without PubSub,
        # but here we just invalidate our own. Others will time out.
        _local_snapshot_cache.pop(workspace_id, None)
    except SupabaseServiceError:
        logger.exception("Failed to persist workspace presence heartbeat | workspace_id=%s", workspace_id)
        pass

    return await list_workspace_presence(workspace_id=workspace_id, user_id=user_id)


async def leave_workspace_presence(
    *,
    workspace_id: str,
    user_id: str,
) -> None:
    """Explicitly mark a user as offline/gone from a workspace presence tracking."""
    redis = get_redis()
    
    # 1. Invalidate distributed snapshot cache for this workspace
    # and live status cache for this user
    try:
        await redis.delete(_presence_snapshot_key(workspace_id))
        await redis.delete(_presence_entry_key(workspace_id, user_id))
        await redis.delete(f"{STATUS_KEY_PREFIX}:{user_id}")
        
        # Clear cooldowns to allow immediate re-entry/re-broadcast if needed
        await redis.delete(f"{COOLDOWN_KEY_PREFIX}:{workspace_id}:{user_id}:heartbeat")
        await redis.delete(f"{COOLDOWN_KEY_PREFIX}:{workspace_id}:{user_id}:typing")
    except Exception:
        logger.error("Redis cache invalidation failed during leave_presence")

    # 2. Invalidate local worker cache
    _local_snapshot_cache.pop(workspace_id, None)

    # 3. Persistent removal from Postgres
    from ..services.supabase_service import delete_many_trusted
    try:
        await delete_many_trusted(
            "workspace_presence",
            {"workspace_id": workspace_id, "user_id": user_id}
        )
    except SupabaseServiceError:
        logger.exception("Failed to remove workspace presence on leave | workspace_id=%s", workspace_id)


async def invalidate_workspace_presence_cache(workspace_id: str):
    """Force invalidation of presence caches for a workspace (e.g. after member removal)."""
    redis = get_redis()
    try:
        await redis.delete(_presence_snapshot_key(workspace_id))
    except Exception:
        pass
    _local_snapshot_cache.pop(workspace_id, None)


async def cleanup_stale_presence() -> int:
    """
    Purge presence records that haven't been updated recently.
    In a Redis-backed model, this is primarily for Postgres maintenance.
    """
    from ..services.supabase_service import delete_many_trusted
    # Records older than 10 minutes are considered long gone
    stale_threshold = (_now() - timedelta(minutes=10)).isoformat()
    try:
        deleted = await delete_many_trusted(
            "workspace_presence",
            {"last_seen_at": {"lt": stale_threshold}}
        )
        count = len(deleted)
        if count > 0:
            logger.info("Cleaned up %d stale presence records.", count)
        return count
    except SupabaseServiceError:
        logger.exception("Failed to cleanup stale presence")
        return 0


async def list_workspace_presence(*, workspace_id: str, user_id: str) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    
    redis = get_redis()
    now_ts = time.perf_counter()
    now = _now()

    # 1. Live Redis presence is the source of truth for online state because
    # browser shutdowns are represented by key expiry, not a final DB write.
    live_rows = await _redis_presence_rows(redis, workspace_id)
    if live_rows:
        result = await _presence_result_from_rows(workspace_id=workspace_id, rows=live_rows, now=now)
        await _cache_presence_result(redis, workspace_id, now_ts, result)
        return result

    if live_rows == []:
        _local_snapshot_cache.pop(workspace_id, None)
    else:
        # Redis failed. Use the short local/snapshot caches before falling back
        # to Postgres so degraded Redis does not take down presence reads.
        cached = _local_snapshot_cache.get(workspace_id)
        if cached and (now_ts - cached[0] < SNAPSHOT_CACHE_TTL):
            return cached[1]

        try:
            redis_cached = await redis.get(_presence_snapshot_key(workspace_id))
            if redis_cached:
                snapshot = json.loads(_redis_text(redis_cached))
                _local_snapshot_cache[workspace_id] = (now_ts, snapshot)
                return snapshot
        except Exception:
            logger.error("Redis fetch failed for presence snapshot")

    # 2. Long-term fallback from Postgres.
    try:
        rows = await select_all_trusted(
            "workspace_presence",
            PRESENCE_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="last_seen_at",
            desc=True,
            limit=100,
        )
    except SupabaseServiceError:
        logger.exception("Failed to load workspace presence | workspace_id=%s", workspace_id)
        raise

    result = await _presence_result_from_rows(workspace_id=workspace_id, rows=rows, now=now)
    await _cache_presence_result(redis, workspace_id, now_ts, result)
    return result


async def log_workspace_activity(
    *,
    workspace_id: str | None,
    actor_user_id: str | None,
    event_type: str,
    summary: str,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not workspace_id:
        return None
    clean_summary = _clean_text(summary, 500)
    if not clean_summary:
        return None

    payload = {
        "workspace_id": workspace_id,
        "actor_user_id": actor_user_id,
        "event_type": _clean_text(event_type, 80) or "workspace.activity",
        "summary": clean_summary,
        "metadata": dict(metadata or {}),
        "created_at": utc_now_iso(),
    }
    try:
        return await insert_one_trusted("workspace_activity_events", payload)
    except SupabaseServiceError:
        logger.exception(
            "Workspace activity logging failed | workspace_id=%s | event_type=%s",
            workspace_id,
            event_type,
        )
        return None


async def list_workspace_activity(
    *,
    workspace_id: str,
    user_id: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    await require_workspace_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "workspace_activity_events",
            ACTIVITY_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="created_at",
            desc=True,
            limit=limit,
        )
    except SupabaseServiceError:
        logger.exception("Failed to load workspace activity | workspace_id=%s", workspace_id)
        return []

    profiles = await get_profiles([str(row.get("actor_user_id") or "") for row in rows])
    activity: list[dict[str, Any]] = []
    for row in rows:
        actor_user_id = str(row.get("actor_user_id") or "")
        profile = profiles.get(actor_user_id, {})
        activity.append(
            {
                "id": str(row.get("id") or ""),
                "workspace_id": str(row.get("workspace_id") or ""),
                "actor_user_id": actor_user_id or None,
                "event_type": row.get("event_type") or "workspace.activity",
                "summary": row.get("summary") or "Workspace activity",
                "metadata": row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {},
                "created_at": row.get("created_at"),
                "actor_name": profile.get("full_name") or profile.get("handle"),
                "actor_email": profile.get("email"),
                "actor_avatar_url": profile.get("avatar_url"),
                "actor_avatar_label": profile.get("avatar_label") or _profile_avatar_label(profile, actor_user_id),
            }
        )
    return activity


def _status_from_counts(
    workspace: Mapping[str, Any],
    *,
    source_count: int,
    active_count: int,
    recently_active_count: int,
    recent_activity_at: datetime | None,
) -> tuple[str, str]:
    workspace_focus = normalize_workspace_focus(workspace.get("workspace_focus") or workspace.get("ai_specialization"))
    ai_status = "active" if source_count > 0 and workspace_focus != "general" else "learning" if source_count > 0 else "ready"

    if active_count > 0:
        return ai_status, "alive"
    if recent_activity_at and _now() - recent_activity_at <= timedelta(hours=1):
        return ai_status, "alive"
    if recently_active_count > 0 or source_count > 0 or workspace_focus != "general":
        return ai_status, "warming"
    return ai_status, "quiet"


async def list_workspace_live_statuses(user_id: str) -> list[dict[str, Any]]:
    redis = get_redis()
    
    # 1. Try Redis for distributed user-scoped cache
    status_key = f"{STATUS_KEY_PREFIX}:{user_id}"
    try:
        redis_cached = await redis.get(status_key)
        if redis_cached:
            return json.loads(redis_cached)
    except Exception:
        logger.error("Redis fetch failed for live statuses")

    # 2. Authoritative build
    workspaces = await list_user_workspaces(user_id)
    normalized_workspaces = [normalize_workspace_record(workspace) for workspace in workspaces]
    workspace_ids = [str(workspace["id"]) for workspace in normalized_workspaces if workspace.get("id")]
    if not workspace_ids:
        return []

    now = _now()

    try:
        presence_rows = await select_all_trusted(
            "workspace_presence",
            PRESENCE_COLUMNS,
            filters={"workspace_id": workspace_ids},
            order_by="last_seen_at",
            desc=True,
            limit=STATUS_PRESENCE_LIMIT,
        )
    except SupabaseServiceError:
        logger.exception("Failed to load workspace status presence.")
        presence_rows = []

    source_counts: Counter[str] = Counter()
    try:
        source_rows = await select_all_trusted(
            "files",
            FILE_STATUS_COLUMNS,
            filters={"workspace_id": workspace_ids},
            limit=STATUS_SOURCE_LIMIT,
        )
        source_counts.update(str(row.get("workspace_id") or "") for row in source_rows if row.get("workspace_id"))
    except SupabaseServiceError:
        logger.exception("Failed to load workspace status source counts.")

    latest_activity_by_workspace_id: dict[str, dict[str, Any]] = {}
    try:
        activity_rows = await select_all_trusted(
            "workspace_activity_events",
            ACTIVITY_COLUMNS,
            filters={"workspace_id": workspace_ids},
            order_by="created_at",
            desc=True,
            limit=STATUS_ACTIVITY_LIMIT,
        )
        for row in activity_rows:
            workspace_id = str(row.get("workspace_id") or "")
            if workspace_id and workspace_id not in latest_activity_by_workspace_id:
                latest_activity_by_workspace_id[workspace_id] = row
    except SupabaseServiceError:
        logger.exception("Failed to load workspace status activity.")

    counts_by_workspace_id: dict[str, dict[str, int]] = {
        workspace_id: {
            "online_count": 0,
            "active_count": 0,
            "recently_active_count": 0,
        }
        for workspace_id in workspace_ids
    }
    for row in presence_rows:
        workspace_id = str(row.get("workspace_id") or "")
        if workspace_id not in counts_by_workspace_id:
            continue
        status = _presence_status(row, now)
        if status == "online":
            counts_by_workspace_id[workspace_id]["online_count"] += 1
            counts_by_workspace_id[workspace_id]["active_count"] += 1
        if status in {"online", "recent"}:
            counts_by_workspace_id[workspace_id]["recently_active_count"] += 1

    statuses: list[dict[str, Any]] = []
    for workspace in normalized_workspaces:
        workspace_id = str(workspace["id"])
        counts = counts_by_workspace_id.get(workspace_id, {})
        latest_activity = latest_activity_by_workspace_id.get(workspace_id)
        recent_activity_at = _parse_dt(latest_activity.get("created_at") if latest_activity else None)
        source_count = source_counts.get(workspace_id, 0)
        ai_status, health = _status_from_counts(
            workspace,
            source_count=source_count,
            active_count=counts.get("active_count", 0),
            recently_active_count=counts.get("recently_active_count", 0),
            recent_activity_at=recent_activity_at,
        )
        statuses.append(
            {
                "workspace_id": workspace_id,
                "online_count": counts.get("online_count", 0),
                "active_count": counts.get("active_count", 0),
                "recently_active_count": counts.get("recently_active_count", 0),
                "typing_count": 0,
                "source_count": source_count,
                "workspace_focus": normalize_workspace_focus(workspace.get("workspace_focus") or workspace.get("ai_specialization")),
                "ai_specialization": normalize_ai_specialization(workspace.get("workspace_focus") or workspace.get("ai_specialization")),
                "ai_status": ai_status,
                "health": health,
                "recent_activity_at": latest_activity.get("created_at") if latest_activity else None,
                "recent_activity_summary": latest_activity.get("summary") if latest_activity else None,
            }
        )

    # 3. Update Redis cache
    try:
        await redis.setex(status_key, STATUS_TTL, json.dumps(statuses))
    except Exception:
        logger.error("Failed to update status cache in Redis")
        
    return statuses
