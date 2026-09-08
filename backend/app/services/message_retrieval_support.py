from __future__ import annotations

from collections.abc import Awaitable, Callable
import logging
import re
from typing import Any

from .supabase_service import select_all, select_all_trusted
from .workspace_intelligence_service import build_workspace_intelligence_profile

logger = logging.getLogger(__name__)

_LIGHTWEIGHT_CONVERSATION_RE = re.compile(
    r"^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|cool|great|nice|got it|sounds good|help)\b[!.?\s]*$",
    re.IGNORECASE,
)


def is_lightweight_conversation(message_text: str) -> bool:
    normalized = " ".join((message_text or "").strip().split())
    return not normalized or bool(_LIGHTWEIGHT_CONVERSATION_RE.match(normalized))


def merge_sources(*source_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in source_groups:
        for source in group:
            if not isinstance(source, dict):
                continue
            key = str(source.get("url") or source.get("id") or source.get("label") or "")
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            merged.append(source)
    return merged


def compact_intelligence_debug(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    if not profile:
        return None
    return {
        "workspace_id": profile.get("workspace_id"),
        "workspace_name": profile.get("workspace_name"),
        "workspace_focus": profile.get("workspace_focus") or profile.get("ai_specialization"),
        "ai_specialization": profile.get("ai_specialization"),
        "retrieval_scope": profile.get("retrieval_scope"),
        "source_count": profile.get("source_count"),
        "active_domains": profile.get("active_domains", [])[:8],
        "scope_workspace_ids": profile.get("scope_workspace_ids", [])[:20],
    }


async def load_workspace_intelligence_for_chat(
    workspace_id: str | None,
    user_id: str,
    *,
    build_workspace_intelligence_profile_fn: Callable[[str, str], Awaitable[dict[str, Any] | None]] = build_workspace_intelligence_profile,
) -> dict[str, Any] | None:
    if not workspace_id:
        return None
    try:
        return await build_workspace_intelligence_profile_fn(workspace_id, user_id)
    except Exception:
        logger.exception("Failed to load workspace intelligence profile for chat; continuing with generic AI context.")
        return None


async def has_retrievable_documents(
    *,
    user_id: str,
    workspace_id: str | None,
    scope_workspace_ids: list[str] | None = None,
    select_all_fn: Callable[..., Awaitable[list[dict[str, Any]]]] = select_all,
    select_all_trusted_fn: Callable[..., Awaitable[list[dict[str, Any]]]] = select_all_trusted,
) -> bool:
    workspace_ids = [
        str(item)
        for item in (scope_workspace_ids or ([workspace_id] if workspace_id else []))
        if str(item or "").strip()
    ]
    if workspace_ids:
        rows = await select_all_trusted_fn(
            "documents",
            "id,workspace_id",
            filters={"workspace_id": workspace_ids},
            limit=1,
        )
        scope_set = set(workspace_ids)
        return any(str(row.get("workspace_id") or "") in scope_set for row in rows)

    rows = await select_all_fn(
        "documents",
        "id,workspace_id",
        filters={"user_id": user_id},
        limit=1,
    )
    return any(not row.get("workspace_id") for row in rows)
