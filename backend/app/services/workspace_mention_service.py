from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
import logging
from typing import Any

from fastapi import HTTPException, status

from ..schemas.workspace_mentions import MentionSourceType
from .supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_many_trusted,
    select_all_trusted,
    select_one_trusted,
    update_many_trusted,
    update_one_trusted,
)
from .workspace_service import WORKSPACE_COLUMNS, get_profiles, list_workspace_members, require_workspace_access

MENTION_COLUMNS = (
    "id,workspace_id,mentioned_user_id,mentioned_by_user_id,source_type,source_id,created_at,read_at"
)
MENTION_SOURCE_TYPES: set[str] = {"conversation_message", "task", "decision"}
logger = logging.getLogger(__name__)


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_mention_user_ids(raw_mentions: Any) -> list[str]:
    if raw_mentions is None:
        return []
    if not isinstance(raw_mentions, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mentions must be a list.")

    normalized: list[str] = []
    for item in raw_mentions:
        raw_user_id: Any
        if isinstance(item, Mapping):
            raw_user_id = item.get("user_id") or item.get("mentioned_user_id")
        else:
            raw_user_id = item
        user_id = _clean_text(raw_user_id)
        if user_id and user_id not in normalized:
            normalized.append(user_id[:120])
    return normalized[:50]


def mention_user_ids_from_payload(payload: Mapping[str, Any]) -> list[str]:
    return normalize_mention_user_ids(payload.get("mentions"))


def _display_name(member: Mapping[str, Any]) -> str | None:
    return _clean_text(member.get("full_name") or member.get("handle") or member.get("email"))


def _mention_label(value: Any, fallback: str) -> str:
    base = str(value or "").strip()
    if "@" in base and not base.startswith("@"):
        base = base.split("@", 1)[0]
    base = base.lstrip("@").split()[0] if base else ""
    label = "".join(char for char in base if char.isalnum() or char in {"_", "-", "."}).strip("._-")
    return label[:40] or fallback[:1].upper() or "U"


def _mention_metadata(member: Mapping[str, Any]) -> dict[str, Any]:
    user_id = str(member.get("user_id") or "")
    display_name = _display_name(member)
    avatar_label = _clean_text(member.get("avatar_label")) or "U"
    return {
        "user_id": user_id,
        "label": _mention_label(member.get("handle") or display_name, avatar_label),
        "display_name": display_name,
        "email": _clean_text(member.get("email")),
        "avatar_url": _clean_text(member.get("avatar_url")),
        "avatar_label": avatar_label,
        "operational_label": _clean_text(member.get("operational_label")),
    }


async def prepare_mentions_for_workspace(
    *,
    workspace: Mapping[str, Any],
    mentions: Any,
) -> list[dict[str, Any]]:
    mention_user_ids = normalize_mention_user_ids(mentions)
    if not mention_user_ids:
        return []

    members = await list_workspace_members(dict(workspace))
    member_by_id = {str(member.get("user_id")): member for member in members if member.get("user_id")}
    unknown = [user_id for user_id in mention_user_ids if user_id not in member_by_id]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mentions must target visible workspace members.",
        )

    return [_mention_metadata(member_by_id[user_id]) for user_id in mention_user_ids]


async def sync_mentions_for_source(
    *,
    workspace_id: str,
    mentioned_by_user_id: str,
    source_type: MentionSourceType,
    source_id: str,
    mentions: list[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    if source_type not in MENTION_SOURCE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported mention source type.")

    try:
        await delete_many_trusted(
            "workspace_mentions",
            {"workspace_id": workspace_id, "source_type": source_type, "source_id": source_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    mention_user_ids = normalize_mention_user_ids(list(mentions))
    if not mention_user_ids:
        return []

    rows = [
        {
            "workspace_id": workspace_id,
            "mentioned_user_id": user_id,
            "mentioned_by_user_id": mentioned_by_user_id,
            "source_type": source_type,
            "source_id": source_id,
        }
        for user_id in mention_user_ids
    ]
    try:
        return await insert_many_trusted("workspace_mentions", rows)
    except SupabaseServiceError as exc:
        raise _database_error() from exc


async def _workspace_for_members(workspace_id: str) -> dict[str, Any]:
    try:
        workspace = await select_one_trusted("workspaces", WORKSPACE_COLUMNS, {"id": workspace_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    return workspace or {"id": workspace_id}


async def mention_metadata_for_sources(
    *,
    workspace_id: str,
    source_type: MentionSourceType,
    source_ids: list[str],
) -> dict[str, list[dict[str, Any]]]:
    unique_source_ids = sorted({str(source_id) for source_id in source_ids if source_id})
    if not unique_source_ids:
        return {}

    try:
        rows = await select_all_trusted(
            "workspace_mentions",
            MENTION_COLUMNS,
            filters={"workspace_id": workspace_id, "source_type": source_type, "source_id": unique_source_ids},
            order_by="created_at",
            desc=False,
            limit=500,
        )
    except SupabaseServiceError:
        logger.warning(
            "Mention metadata hydration failed | workspace_id=%s | source_type=%s",
            workspace_id,
            source_type,
            exc_info=True,
        )
        return {source_id: [] for source_id in unique_source_ids}

    if not rows:
        return {source_id: [] for source_id in unique_source_ids}

    workspace = await _workspace_for_members(workspace_id)
    members = await list_workspace_members(workspace)
    member_by_id = {str(member.get("user_id")): member for member in members if member.get("user_id")}
    mentioned_ids = [str(row.get("mentioned_user_id")) for row in rows if row.get("mentioned_user_id")]
    profiles = await get_profiles(mentioned_ids)

    grouped: dict[str, list[dict[str, Any]]] = {source_id: [] for source_id in unique_source_ids}
    for row in rows:
        source_id = str(row.get("source_id") or "")
        mentioned_user_id = str(row.get("mentioned_user_id") or "")
        if not source_id or not mentioned_user_id:
            continue
        member = member_by_id.get(mentioned_user_id)
        if member:
            metadata = _mention_metadata(member)
        else:
            profile = profiles.get(mentioned_user_id, {})
            metadata = {
                "user_id": mentioned_user_id,
                "label": _mention_label(profile.get("handle") or profile.get("full_name") or profile.get("email"), profile.get("avatar_label") or "U"),
                "display_name": _clean_text(profile.get("full_name") or profile.get("handle") or profile.get("email")),
                "email": _clean_text(profile.get("email")),
                "avatar_url": _clean_text(profile.get("avatar_url")),
                "avatar_label": _clean_text(profile.get("avatar_label")) or "U",
                "operational_label": None,
            }
        grouped.setdefault(source_id, []).append(metadata)
    return grouped


def _source_preview(value: Any, fallback: str = "") -> str | None:
    text = " ".join(str(value or fallback).split())
    if not text:
        return None
    return text if len(text) <= 180 else f"{text[:177].rstrip()}..."


def _profile_label(user_id: str, profiles: Mapping[str, Mapping[str, Any]]) -> tuple[str | None, str | None, str]:
    profile = profiles.get(user_id, {})
    name = _clean_text(profile.get("full_name") or profile.get("handle") or profile.get("email"))
    email = _clean_text(profile.get("email"))
    avatar_label = _clean_text(profile.get("avatar_label")) or "U"
    return name, email, avatar_label


async def _conversation_source_details(
    *,
    workspace_id: str,
    user_id: str,
    source_ids: list[str],
) -> dict[str, dict[str, str | None]]:
    try:
        messages = await select_all_trusted(
            "workspace_channel_messages",
            "id,workspace_id,channel_id,content,created_at",
            filters={"workspace_id": workspace_id, "id": source_ids},
        )
    except SupabaseServiceError:
        logger.warning("Mention conversation source hydration failed | workspace_id=%s", workspace_id, exc_info=True)
        return {}

    channel_ids = sorted({str(message.get("channel_id")) for message in messages if message.get("channel_id")})
    channels = []
    memberships = []
    if channel_ids:
        try:
            channels = await select_all_trusted(
                "workspace_channels",
                "id,name,visibility,created_by",
                filters={"workspace_id": workspace_id, "id": channel_ids},
            )
            memberships = await select_all_trusted(
                "workspace_channel_members",
                "channel_id,user_id",
                filters={"channel_id": channel_ids, "user_id": user_id},
            )
        except SupabaseServiceError as exc:
            logger.warning(
                "Mention conversation channel hydration failed | workspace_id=%s",
                workspace_id,
                exc_info=True,
            )
            return {}

    channel_by_id = {str(channel.get("id")): channel for channel in channels}
    member_channel_ids = {str(member.get("channel_id")) for member in memberships}
    details: dict[str, dict[str, str | None]] = {}
    for message in messages:
        channel_id = str(message.get("channel_id") or "")
        channel = channel_by_id.get(channel_id, {})
        visibility = str(channel.get("visibility") or "workspace")
        can_read = (
            visibility == "workspace"
            or str(channel.get("created_by") or "") == user_id
            or channel_id in member_channel_ids
        )
        if not can_read:
            continue
        details[str(message["id"])] = {
            "title": str(channel.get("name") or "Workspace conversation"),
            "preview": _source_preview(message.get("content")),
            "url": f"/conversations?channel={channel_id}",
        }
    return details


async def _task_source_details(workspace_id: str, source_ids: list[str]) -> dict[str, dict[str, str | None]]:
    try:
        tasks = await select_all_trusted(
            "workspace_tasks",
            "id,title,description",
            filters={"workspace_id": workspace_id, "id": source_ids},
        )
    except SupabaseServiceError:
        logger.warning("Mention task source hydration failed | workspace_id=%s", workspace_id, exc_info=True)
        return {}
    return {
        str(task["id"]): {
            "title": str(task.get("title") or "Task"),
            "preview": _source_preview(task.get("description")),
            "url": f"/tasks?id={task['id']}",
        }
        for task in tasks
    }


async def _decision_source_details(workspace_id: str, source_ids: list[str]) -> dict[str, dict[str, str | None]]:
    try:
        decisions = await select_all_trusted(
            "workspace_decisions",
            "id,title,description,decision_reason",
            filters={"workspace_id": workspace_id, "id": source_ids},
        )
    except SupabaseServiceError:
        logger.warning("Mention decision source hydration failed | workspace_id=%s", workspace_id, exc_info=True)
        return {}
    return {
        str(decision["id"]): {
            "title": str(decision.get("title") or "Decision"),
            "preview": _source_preview(decision.get("decision_reason") or decision.get("description")),
            "url": f"/decisions?id={decision['id']}",
        }
        for decision in decisions
    }


async def list_mentions_for_user(
    *,
    workspace_id: str,
    user_id: str,
    only_unread: bool = False,
    limit: int | None = 100,
) -> list[dict[str, Any]]:
    await require_workspace_access(workspace_id, user_id)
    filters: dict[str, Any] = {"workspace_id": workspace_id, "mentioned_user_id": user_id}
    if only_unread:
        filters["read_at"] = {"is": None}

    try:
        rows = await select_all_trusted(
            "workspace_mentions",
            MENTION_COLUMNS,
            filters=filters,
            order_by="created_at",
            desc=True,
            limit=limit,
        )
    except SupabaseServiceError:
        logger.warning(
            "Mention inbox storage unavailable | workspace_id=%s | user_id=%s",
            workspace_id,
            user_id,
            exc_info=True,
        )
        return []

    if not rows:
        return []

    actor_ids = sorted({str(row.get("mentioned_by_user_id")) for row in rows if row.get("mentioned_by_user_id")})
    profiles = await get_profiles(actor_ids + [user_id])
    conversation_ids = [str(row["source_id"]) for row in rows if row.get("source_type") == "conversation_message"]
    task_ids = [str(row["source_id"]) for row in rows if row.get("source_type") == "task"]
    decision_ids = [str(row["source_id"]) for row in rows if row.get("source_type") == "decision"]

    source_details: dict[str, dict[str, dict[str, str | None]]] = {
        "conversation_message": await _conversation_source_details(
            workspace_id=workspace_id,
            user_id=user_id,
            source_ids=conversation_ids,
        ) if conversation_ids else {},
        "task": await _task_source_details(workspace_id, task_ids) if task_ids else {},
        "decision": await _decision_source_details(workspace_id, decision_ids) if decision_ids else {},
    }
    mentioned_user_name, _, _ = _profile_label(user_id, profiles)

    hydrated: list[dict[str, Any]] = []
    for row in rows:
        source_type = str(row.get("source_type") or "")
        source_id = str(row.get("source_id") or "")
        details = source_details.get(source_type, {}).get(source_id)
        if not details:
            continue
        actor_id = str(row.get("mentioned_by_user_id") or "")
        actor_name, actor_email, actor_avatar_label = _profile_label(actor_id, profiles)
        hydrated.append(
            {
                **row,
                "mentioned_by_name": actor_name,
                "mentioned_by_email": actor_email,
                "mentioned_by_avatar_label": actor_avatar_label,
                "mentioned_user_name": mentioned_user_name,
                "source_title": details["title"] or "Workspace record",
                "source_preview": details["preview"],
                "source_url": details["url"] or "/mentions",
            }
        )
    return hydrated


async def count_unread_mentions_for_user(
    *,
    workspace_id: str,
    user_id: str,
) -> dict[str, int]:
    rows = await list_mentions_for_user(
        workspace_id=workspace_id,
        user_id=user_id,
        only_unread=True,
        limit=None,
    )
    return {"unread_count": len(rows)}


async def mark_mention_read(
    *,
    workspace_id: str,
    user_id: str,
    mention_id: str,
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)

    try:
        existing = await select_one_trusted(
            "workspace_mentions",
            MENTION_COLUMNS,
            {"id": mention_id, "workspace_id": workspace_id, "mentioned_user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mention not found.")

    if existing.get("read_at"):
        return {"mention_id": str(existing.get("id") or mention_id), "read_at": existing["read_at"]}

    read_at = _utc_now()
    try:
        updated = await update_one_trusted(
            "workspace_mentions",
            {"id": mention_id, "workspace_id": workspace_id, "mentioned_user_id": user_id},
            {"read_at": read_at.isoformat()},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mention not found.")

    return {"mention_id": str(updated.get("id") or mention_id), "read_at": updated.get("read_at") or read_at}


async def mark_all_mentions_read(
    *,
    workspace_id: str,
    user_id: str,
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    read_at = _utc_now()

    try:
        updated = await update_many_trusted(
            "workspace_mentions",
            {"workspace_id": workspace_id, "mentioned_user_id": user_id, "read_at": {"is": None}},
            {"read_at": read_at.isoformat()},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return {"updated_count": len(updated), "read_at": read_at}
