from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException, status

from .supabase_service import (
    SupabaseServiceError,
    insert_one_trusted,
    select_all_trusted,
    select_one_trusted,
)
from .workspace_collaboration_service import log_workspace_activity
from .workspace_conversation_service import MESSAGE_COLUMNS, _require_channel_access
from .workspace_service import get_profiles, require_workspace_access, utc_now_iso

DECISION_COLUMNS = (
    "id,workspace_id,title,description,decision_reason,status,source_message_id,"
    "source_channel_id,created_by,created_at,updated_at"
)
DECISION_STATUSES = ("proposed", "accepted", "rejected", "superseded")


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Decision not found.")


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _title_from_text(content: Any) -> str:
    normalized = " ".join(str(content or "").split())
    if not normalized:
        return "Recorded decision"
    return normalized if len(normalized) <= 110 else f"{normalized[:107].rstrip()}..."


async def _hydrate_decisions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    creator_ids = sorted({str(row.get("created_by")) for row in rows if row.get("created_by")})
    profiles = await get_profiles(creator_ids)
    hydrated: list[dict[str, Any]] = []
    for row in rows:
        creator = profiles.get(str(row.get("created_by") or ""), {})
        hydrated.append(
            {
                **row,
                "creator_name": creator.get("full_name") or creator.get("handle") or creator.get("email"),
                "creator_email": creator.get("email"),
                "creator_avatar_label": creator.get("avatar_label"),
            }
        )
    return hydrated


def _normalize_status(value: Any) -> str:
    decision_status = str(value or "accepted")
    if decision_status not in DECISION_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported decision status.")
    return decision_status


async def list_decisions(*, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    await require_workspace_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "workspace_decisions",
            DECISION_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="updated_at",
            desc=True,
            limit=300,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    return await _hydrate_decisions(rows)


async def require_decision(*, workspace_id: str, decision_id: str, user_id: str) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    try:
        row = await select_one_trusted(
            "workspace_decisions",
            DECISION_COLUMNS,
            {"id": decision_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if row is None:
        raise _not_found()
    return row


async def get_decision(*, workspace_id: str, decision_id: str, user_id: str) -> dict[str, Any]:
    row = await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)
    return (await _hydrate_decisions([row]))[0]


async def create_decision(
    *,
    workspace_id: str,
    user_id: str,
    payload: Mapping[str, Any],
    origin: str = "manual",
    source_channel_id: str | None = None,
    source_message_id: str | None = None,
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    title = _clean_text(payload.get("title"))
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision title cannot be empty.")

    timestamp = utc_now_iso()
    record = {
        "workspace_id": workspace_id,
        "title": title,
        "description": _clean_text(payload.get("description")),
        "decision_reason": _clean_text(payload.get("decision_reason")),
        "status": _normalize_status(payload.get("status")),
        "source_message_id": source_message_id,
        "source_channel_id": source_channel_id,
        "created_by": user_id,
        "updated_at": timestamp,
    }
    try:
        created = await insert_one_trusted("workspace_decisions", record)
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="decision.created",
        summary=f"Decision recorded: {title}.",
        metadata={
            "decision_id": created.get("id"),
            "status": record["status"],
            "origin": origin,
            "source_channel_id": source_channel_id,
            "source_message_id": source_message_id,
        },
    )
    return (await _hydrate_decisions([created]))[0]


async def create_decision_from_message(
    *,
    workspace_id: str,
    channel_id: str,
    message_id: str,
    user_id: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    await _require_channel_access(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=user_id,
    )
    try:
        message = await select_one_trusted(
            "workspace_channel_messages",
            MESSAGE_COLUMNS,
            {"id": message_id, "workspace_id": workspace_id, "channel_id": channel_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation message not found.")

    source_content = str(message.get("content") or "")
    decision_payload = {
        **payload,
        "title": _clean_text(payload.get("title")) or _title_from_text(source_content),
        "description": _clean_text(payload.get("description")) or source_content,
    }
    return await create_decision(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=decision_payload,
        origin="conversation_message",
        source_channel_id=channel_id,
        source_message_id=message_id,
    )
