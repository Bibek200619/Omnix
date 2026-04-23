from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

from ..services.supabase_service import (
    SupabaseServiceError,
    insert_one_trusted,
    select_all_trusted,
    upsert_one,
)
from .workspace_service import (
    WORKSPACE_COLUMNS,
    get_profiles,
    list_user_workspaces,
    normalize_ai_specialization,
    normalize_workspace_record,
    require_workspace_access,
    utc_now_iso,
)

logger = logging.getLogger(__name__)

PRESENCE_COLUMNS = (
    "workspace_id,user_id,status,current_view,current_label,typing_until,"
    "typing_conversation_id,metadata,last_seen_at,created_at,updated_at"
)
ACTIVITY_COLUMNS = "id,workspace_id,actor_user_id,event_type,summary,metadata,created_at"
FILE_STATUS_COLUMNS = "id,workspace_id"

ONLINE_WINDOW = timedelta(seconds=90)
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


def _presence_is_typing(row: Mapping[str, Any], now: datetime) -> bool:
    typing_until = _parse_dt(row.get("typing_until"))
    return bool(typing_until and typing_until > now)


def _presence_member_payload(
    row: Mapping[str, Any],
    profile: Mapping[str, Any],
    now: datetime,
) -> dict[str, Any]:
    user_id = str(row.get("user_id") or "")
    status = _presence_status(row, now)
    is_typing = _presence_is_typing(row, now)
    return {
        "workspace_id": str(row.get("workspace_id") or ""),
        "user_id": user_id,
        "status": status,
        "current_view": row.get("current_view"),
        "current_label": row.get("current_label"),
        "is_online": status == "online",
        "is_typing": is_typing,
        "typing_conversation_id": row.get("typing_conversation_id"),
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
        await upsert_one("workspace_presence", payload, on_conflict="workspace_id,user_id")
    except SupabaseServiceError:
        logger.exception("Failed to persist workspace presence heartbeat | workspace_id=%s", workspace_id)
        raise

    return await list_workspace_presence(workspace_id=workspace_id, user_id=user_id)


async def leave_workspace_presence(
    *,
    workspace_id: str,
    user_id: str,
) -> None:
    """Explicitly mark a user as offline/gone from a workspace presence tracking."""
    # We use a trusted delete because we already validated workspace_id/user_id via router
    from ..services.supabase_service import delete_many_trusted
    try:
        await delete_many_trusted(
            "workspace_presence",
            {"workspace_id": workspace_id, "user_id": user_id}
        )
    except SupabaseServiceError:
        logger.exception("Failed to remove workspace presence on leave | workspace_id=%s", workspace_id)


async def cleanup_stale_presence() -> int:
    """Purge presence records that haven't been updated recently."""
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


async def update_workspace_typing(
    *,
    workspace_id: str,
    user_id: str,
    conversation_id: str | None,
    is_typing: bool,
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    timestamp = utc_now_iso()
    typing_until = (_now() + TYPING_WINDOW).isoformat() if is_typing else None
    payload = {
        "workspace_id": workspace_id,
        "user_id": user_id,
        "status": "online",
        "typing_until": typing_until,
        "typing_conversation_id": conversation_id if is_typing else None,
        "last_seen_at": timestamp,
        "updated_at": timestamp,
    }
    try:
        await upsert_one("workspace_presence", payload, on_conflict="workspace_id,user_id")
    except SupabaseServiceError:
        logger.exception("Failed to persist typing state | workspace_id=%s", workspace_id)
        raise

    return await list_workspace_presence(workspace_id=workspace_id, user_id=user_id)


async def list_workspace_presence(*, workspace_id: str, user_id: str) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    now = _now()
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
    typing_members = [member for member in online_members if member.get("is_typing")]

    return {
        "workspace_id": workspace_id,
        "online_count": len(online_members),
        "active_count": len(online_members),
        "recently_active_count": len(recently_active_members),
        "typing_count": len(typing_members),
        "online_members": online_members,
        "active_members": online_members,
        "recently_active_members": recently_active_members,
        "typing_members": typing_members,
        "updated_at": now.isoformat(),
    }


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
    ai_specialization = normalize_ai_specialization(workspace.get("ai_specialization"))
    ai_status = "active" if source_count > 0 and ai_specialization != "general" else "learning" if source_count > 0 else "ready"

    if active_count > 0:
        return ai_status, "alive"
    if recent_activity_at and _now() - recent_activity_at <= timedelta(hours=1):
        return ai_status, "alive"
    if recently_active_count > 0 or source_count > 0 or ai_specialization != "general":
        return ai_status, "warming"
    return ai_status, "quiet"


async def list_workspace_live_statuses(user_id: str) -> list[dict[str, Any]]:
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
            "typing_count": 0,
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
            if _presence_is_typing(row, now):
                counts_by_workspace_id[workspace_id]["typing_count"] += 1
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
                "typing_count": counts.get("typing_count", 0),
                "source_count": source_count,
                "ai_specialization": normalize_ai_specialization(workspace.get("ai_specialization")),
                "ai_status": ai_status,
                "health": health,
                "recent_activity_at": latest_activity.get("created_at") if latest_activity else None,
                "recent_activity_summary": latest_activity.get("summary") if latest_activity else None,
            }
        )

    return statuses
