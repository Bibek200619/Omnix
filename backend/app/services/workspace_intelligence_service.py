from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException

from ..bootstrap.redis import get_redis
from ..services.supabase_service import SupabaseServiceError, select_all_trusted
from .workspace_cognition import build_workspace_focus_prompt, normalize_workspace_focus
from .workspace_service import (
    list_workspace_members,
    normalize_intelligence_preferences,
    normalize_workspace_record,
    require_workspace_access,
)

FILE_COLUMNS = "id,file_name,file_type,workspace_id,metadata,created_at"
CONVERSATION_COLUMNS = "id,title,workspace_id,last_message_at,updated_at,created_at"
DOMAIN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+#-]{2,}")
logger = logging.getLogger(__name__)

# Cache for intelligence profiles to reduce massive read amplification
# Structure: {(workspace_id, user_id): (timestamp, profile_dict)}
_intelligence_profile_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
INTELLIGENCE_CACHE_TTL = 60.0  # Seconds
INTELLIGENCE_CACHE_TTL_SECONDS = int(INTELLIGENCE_CACHE_TTL)
INTELLIGENCE_CACHE_KEY_PREFIX = "omnix:intelligence"
INTELLIGENCE_INVALIDATION_CHANNEL = "omnix:cache:invalidate"
_intelligence_invalidation_task: asyncio.Task | None = None
_intelligence_invalidation_pubsub: Any | None = None


def _intelligence_cache_key(workspace_id: str, user_id: str) -> str:
    return f"{INTELLIGENCE_CACHE_KEY_PREFIX}:{workspace_id}:{user_id}"


def _intelligence_cache_pattern(workspace_id: str) -> str:
    return f"{INTELLIGENCE_CACHE_KEY_PREFIX}:{workspace_id}:*"


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


def _drop_local_intelligence_cache(workspace_id: str, user_id: str | None = None) -> None:
    for cache_key in list(_intelligence_profile_cache):
        cached_workspace_id, cached_user_id = cache_key
        if cached_workspace_id == workspace_id and (user_id is None or cached_user_id == user_id):
            _intelligence_profile_cache.pop(cache_key, None)


async def _cached_intelligence_profile(
    workspace_id: str,
    user_id: str,
    now_ts: float,
) -> dict[str, Any] | None:
    cache_key = (workspace_id, user_id)
    redis_key = _intelligence_cache_key(workspace_id, user_id)

    try:
        raw = await get_redis().get(redis_key)
        if raw:
            profile = json.loads(_redis_text(raw))
            if isinstance(profile, dict):
                _intelligence_profile_cache[cache_key] = (now_ts, profile)
                return profile
        _intelligence_profile_cache.pop(cache_key, None)
        return None
    except Exception:
        logger.warning("Workspace intelligence Redis cache read failed; using local fallback.", exc_info=True)

    cached = _intelligence_profile_cache.get(cache_key)
    if cached and (now_ts - cached[0] < INTELLIGENCE_CACHE_TTL):
        return cached[1]
    return None


async def _store_intelligence_profile(
    workspace_id: str,
    user_id: str,
    now_ts: float,
    profile: dict[str, Any],
) -> None:
    _intelligence_profile_cache[(workspace_id, user_id)] = (now_ts, profile)
    try:
        await get_redis().setex(
            _intelligence_cache_key(workspace_id, user_id),
            INTELLIGENCE_CACHE_TTL_SECONDS,
            json.dumps(profile, default=str),
        )
    except Exception:
        logger.warning("Workspace intelligence Redis cache write failed; kept local fallback.", exc_info=True)


async def invalidate_workspace_intelligence_cache(
    workspace_id: str,
    user_id: str | None = None,
    *,
    publish: bool = True,
) -> None:
    _drop_local_intelligence_cache(workspace_id, user_id)

    try:
        redis = get_redis()
        keys = (
            [_intelligence_cache_key(workspace_id, user_id)]
            if user_id
            else await _scan_redis_keys(redis, _intelligence_cache_pattern(workspace_id))
        )
        if keys:
            await redis.delete(*keys)
        if publish:
            await redis.publish(
                INTELLIGENCE_INVALIDATION_CHANNEL,
                json.dumps({"type": "intelligence", "workspace_id": workspace_id, "user_id": user_id}),
            )
    except Exception:
        logger.warning("Workspace intelligence cache invalidation publish failed.", exc_info=True)


async def _handle_intelligence_invalidation_message(raw_payload: Any) -> None:
    try:
        payload = json.loads(_redis_text(raw_payload))
    except (TypeError, ValueError):
        return
    if not isinstance(payload, dict) or payload.get("type") != "intelligence":
        return
    workspace_id = str(payload.get("workspace_id") or "")
    user_id = payload.get("user_id")
    if not workspace_id:
        return
    _drop_local_intelligence_cache(workspace_id, str(user_id) if user_id else None)


async def _listen_for_intelligence_invalidations(pubsub: Any) -> None:
    try:
        async for message in pubsub.listen():
            if not isinstance(message, dict) or message.get("type") != "message":
                continue
            await _handle_intelligence_invalidation_message(message.get("data"))
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning("Workspace intelligence invalidation listener stopped unexpectedly.", exc_info=True)


async def start_intelligence_cache_invalidation_listener() -> None:
    global _intelligence_invalidation_task, _intelligence_invalidation_pubsub
    if _intelligence_invalidation_task and not _intelligence_invalidation_task.done():
        return
    try:
        pubsub = get_redis().pubsub()
        await pubsub.subscribe(INTELLIGENCE_INVALIDATION_CHANNEL)
        _intelligence_invalidation_pubsub = pubsub
        _intelligence_invalidation_task = asyncio.create_task(_listen_for_intelligence_invalidations(pubsub))
    except Exception:
        logger.warning("Workspace intelligence invalidation listener could not start.", exc_info=True)


async def stop_intelligence_cache_invalidation_listener() -> None:
    global _intelligence_invalidation_task, _intelligence_invalidation_pubsub
    task = _intelligence_invalidation_task
    pubsub = _intelligence_invalidation_pubsub
    _intelligence_invalidation_task = None
    _intelligence_invalidation_pubsub = None

    if task and not task.done():
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    if pubsub is not None:
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe(INTELLIGENCE_INVALIDATION_CHANNEL)
        close = getattr(pubsub, "aclose", None) or getattr(pubsub, "close", None)
        if callable(close):
            with contextlib.suppress(Exception):
                result = close()
                if hasattr(result, "__await__"):
                    await result


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _source_payload(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
    return {
        "id": str(row.get("id") or ""),
        "name": row.get("file_name") or "Workspace source",
        "type": row.get("file_type") or metadata.get("source_type") or "document",
        "workspace_id": str(row.get("workspace_id") or ""),
        "created_at": row.get("created_at"),
    }


def _domain_candidates(workspace: dict[str, Any], files: list[dict[str, Any]]) -> list[str]:
    text_blocks = [
        workspace.get("description") or "",
        workspace.get("expertise_area") or "",
        workspace.get("workspace_focus") or workspace.get("ai_specialization") or "",
    ]
    text_blocks.extend(str(file.get("file_name") or "") for file in files)
    text_blocks.extend(str(file.get("file_type") or "") for file in files)

    stopwords = {
        "workspace",
        "document",
        "documents",
        "source",
        "sources",
        "application",
        "plain",
        "markdown",
        "octet",
        "stream",
        "uploaded",
        "team",
        "global",
        "general",
    }
    counts: dict[str, int] = {}
    for block in text_blocks:
        for token in DOMAIN_RE.findall(block):
            normalized = token.strip("-_").lower()
            if len(normalized) < 3 or normalized in stopwords:
                continue
            counts[normalized] = counts.get(normalized, 0) + 1

    return [
        token
        for token, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:8]
    ]


def _insights(
    workspace: dict[str, Any],
    *,
    source_count: int,
    conversation_count: int,
    member_count: int,
    domains: list[str],
) -> list[str]:
    insights: list[str] = []
    if source_count:
        insights.append(f"{source_count} connected source{'s' if source_count != 1 else ''} shape this workspace context.")
    else:
        insights.append("No knowledge sources are connected yet.")
    if domains:
        insights.append(f"Active knowledge domains: {', '.join(domains[:4])}.")
    if conversation_count:
        insights.append(f"{conversation_count} AI conversation{'s' if conversation_count != 1 else ''} are scoped to this workspace.")
    if workspace.get("is_global"):
        insights.append("Global intelligence can draw from the parent workspace and sibling subspaces.")
    elif member_count > 1:
        insights.append("Collaborative memory is shared with workspace members.")
    return insights[:4]


def _summary(workspace: dict[str, Any], domains: list[str], source_count: int) -> str:
    name = workspace.get("name") or "This workspace"
    focus = normalize_workspace_focus(workspace.get("workspace_focus") or workspace.get("ai_specialization"))
    expertise = _text(workspace.get("expertise_area"))
    if expertise:
        return f"{name} specializes in {expertise}. Cognitive focus is {focus}; {source_count} source(s) are active."
    if domains:
        return f"{name} is currently oriented around {', '.join(domains[:4])}. Cognitive focus is {focus}; {source_count} source(s) are active."
    return f"{name} is using {focus} focus with workspace-scoped memory."


async def workspace_retrieval_scope_ids(
    workspace: dict[str, Any],
    user_id: str,
) -> list[str]:
    """
    ARCHITECTURE NOTE (Shared Organizational Memory):
    This function defines the 'Knowledge Hub' logic for Omnix. 
    Global workspaces act as bridges between disparate teams, while Isolated 
    workspaces maintain strict privacy boundaries. 
    
    Future agents will utilize these scope IDs to navigate the organizational 
    intelligence graph safely.
    """
    from app.services.workspace_service import list_user_workspaces
    
    normalized = normalize_workspace_record(workspace)
    workspace_id = str(normalized["id"])
    preferences = normalized.get("intelligence_preferences") or {}

    if not normalized.get("is_global") and preferences.get("retrieval_scope") != "global":
        return [workspace_id]

    parent_id = str(normalized.get("parent_workspace_id") or "")
    if not parent_id:
        return [workspace_id]

    # Scope retrieval to ONLY the workspaces the user is explicitly authorized to view within the organization.
    user_workspaces = await list_user_workspaces(user_id)
    
    ids = []
    # If the user has access to the parent, include it
    if any(str(w.get("id")) == parent_id for w in user_workspaces):
        ids.append(parent_id)
        
    # Include any visible subspaces that belong to this super workspace
    for w in user_workspaces:
        if str(w.get("parent_workspace_id") or "") == parent_id:
            ids.append(str(w["id"]))
    
    # Ensure the requested workspace is always included even if it's not in the subspace list (race condition safety)
    if workspace_id not in ids:
        ids.append(workspace_id)
        
    return list(dict.fromkeys(ids))


async def _optional_select_all(
    table: str,
    columns: str,
    *,
    filters: Mapping[str, Any] | None = None,
    order_by: str | None = None,
    desc: bool = False,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    try:
        return await select_all_trusted(
            table,
            columns,
            filters=filters,
            order_by=order_by,
            desc=desc,
            limit=limit,
        )
    except SupabaseServiceError:
        logger.warning("Workspace intelligence optional read failed | table=%s", table, exc_info=True)
        return []


async def build_workspace_intelligence_profile(
    workspace_id: str,
    user_id: str,
) -> dict[str, Any]:
    now_ts = time.perf_counter()
    cached = await _cached_intelligence_profile(workspace_id, user_id, now_ts)
    if cached:
        return cached

    access = await require_workspace_access(workspace_id, user_id)
    workspace = normalize_workspace_record(access.workspace)
    scope_ids = await workspace_retrieval_scope_ids(workspace, user_id)

    files = await _optional_select_all(
        "files",
        FILE_COLUMNS,
        filters={"workspace_id": scope_ids},
        order_by="created_at",
        desc=True,
        limit=50,
    )
    scoped_files = [
        row for row in files if str(row.get("workspace_id") or "") in set(scope_ids)
    ]

    conversations = await _optional_select_all(
        "conversations",
        CONVERSATION_COLUMNS,
        filters={"workspace_id": scope_ids},
        order_by="updated_at",
        desc=True,
        limit=20,
    )
    scoped_conversations = [
        row for row in conversations if str(row.get("workspace_id") or "") in set(scope_ids)
    ]

    try:
        members = await list_workspace_members(workspace)
    except HTTPException as exc:
        if exc.status_code < 500:
            raise
        logger.warning("Workspace intelligence member hydration failed | workspace_id=%s", workspace_id, exc_info=True)
        members = []

    # Initiative direction is injected as recorded context only; health is derived at the initiative surface.
    initiatives = await _optional_select_all(
        "workspace_initiatives",
        "*",
        filters={"workspace_id": scope_ids, "status": ["active", "focused", "at_risk"]},
        order_by="updated_at",
        desc=True,
        limit=5,
    )

    unresolved_continuity = await _optional_select_all(
        "workspace_intelligence_memory",
        "*",
        filters={
            "workspace_id": scope_ids,
            "resolution_status": ["unresolved", "pending_collaboration", "blocked"],
        },
        order_by="importance_score",
        desc=True,
        limit=5,
    )

    domains = _domain_candidates(workspace, scoped_files)
    preferences = normalize_intelligence_preferences(
        workspace.get("intelligence_preferences"),
        is_global=bool(workspace.get("is_global")),
    )

    retrieval_scope = "global" if workspace.get("is_global") or preferences.get("retrieval_scope") == "global" else "workspace"
    workspace_focus = normalize_workspace_focus(workspace.get("workspace_focus") or workspace.get("ai_specialization"))
    profile = {
        "workspace_id": str(workspace["id"]),
        "workspace_name": str(workspace.get("name") or "Workspace"),
        "workspace_type": workspace.get("workspace_type") or "super_workspace",
        "is_global": bool(workspace.get("is_global")),
        "parent_workspace_id": workspace.get("parent_workspace_id"),
        "description": workspace.get("description"),
        "expertise_area": workspace.get("expertise_area"),
        "workspace_focus": workspace_focus,
        "ai_specialization": workspace_focus,
        "ai_instructions": workspace.get("ai_instructions"),
        "intelligence_preferences": preferences,
        "source_count": len(scoped_files),
        "conversation_count": len(scoped_conversations),
        "member_count": len(members),
        "active_domains": domains,
        "connected_sources": [_source_payload(row) for row in scoped_files[:8]],
        "retrieval_scope": retrieval_scope,
        "scope_workspace_ids": scope_ids,
        "active_initiatives": [
            {"id": str(i["id"]), "title": i.get("title") or i.get("name"), "status": i["status"]}
            for i in initiatives
        ],
        "unresolved_continuity": [
            {"content": c["content"], "status": c["resolution_status"]}
            for c in unresolved_continuity
        ],
    }
    profile["context_summary"] = _summary(workspace, domains, len(scoped_files))
    profile["recent_insights"] = _insights(
        workspace,
        source_count=len(scoped_files),
        conversation_count=len(scoped_conversations),
        member_count=len(members),
        domains=domains,
    )

    await _store_intelligence_profile(workspace_id, user_id, now_ts, profile)
    return profile


def workspace_intelligence_system_prompt(
    profile: dict[str, Any] | None,
    *,
    focus_override: Any | None = None,
    include_focus: bool = True,
) -> str:
    if not profile:
        return ""
    workspace_focus = normalize_workspace_focus(
        focus_override or profile.get("workspace_focus") or profile.get("ai_specialization")
    )
    preferences = profile.get("intelligence_preferences")
    lines = []
    if include_focus:
        lines.extend([build_workspace_focus_prompt(workspace_focus), ""])
    lines.extend([
        "WORKSPACE INTELLIGENCE PROFILE:",
        f"- Active workspace: {profile.get('workspace_name')} ({profile.get('workspace_type')})",
        f"- Workspace cognitive focus: {workspace_focus}",
        f"- Retrieval scope: {profile.get('retrieval_scope') or 'workspace'}",
        f"- Context summary: {profile.get('context_summary')}",
    ])
    if isinstance(preferences, Mapping) and preferences.get("memory_enabled") is False:
        lines.append("- Workspace memory is disabled; apply the cognitive focus but do not rely on continuity memory unless it is explicitly retrieved or provided.")
        if profile.get("ai_instructions"):
            lines.append(f"- Workspace instructions: {profile['ai_instructions']}")
        return "\n".join(line for line in lines if line is not None)

    if profile.get("description"):
        lines.append(f"- Workspace description: {profile['description']}")
    if profile.get("expertise_area"):
        lines.append(f"- Expertise area: {profile['expertise_area']}")
    if profile.get("active_domains"):
        lines.append(f"- Active knowledge domains: {', '.join(profile['active_domains'][:8])}")
    if profile.get("source_count") is not None:
        lines.append(f"- Connected sources in scope: {profile.get('source_count')}")

    # Inject Continuity Intelligence (Phase 8)
    if profile.get("active_initiatives"):
        initiatives_str = ", ".join(i["title"] for i in profile["active_initiatives"])
        lines.append(f"- Active initiatives: {initiatives_str}")
    
    if profile.get("unresolved_continuity"):
        lines.append("- Unresolved continuity memory:")
        for c in profile["unresolved_continuity"]:
            lines.append(f"  * {c['content']} ({c['status']})")

    if profile.get("ai_instructions"):
        lines.append(f"- Workspace instructions: {profile['ai_instructions']}")

    lines.extend(
        [
            "",
            "Use this profile to adapt terminology, assumptions, and collaboration style.",
            "Prefer workspace-scoped knowledge and cite retrieved sources when available.",
            "If the profile or sources do not contain the answer, say what is missing before using general knowledge.",
        ]
    )
    return "\n".join(line for line in lines if line is not None)
