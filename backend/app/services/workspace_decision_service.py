from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

from fastapi import HTTPException, status

from .supabase_service import (
    SupabaseServiceError,
    delete_one_trusted,
    insert_one_trusted,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)
from .workspace_collaboration_service import log_workspace_activity
from .workspace_conversation_service import MESSAGE_COLUMNS, _require_channel_access
from .workspace_mention_service import (
    mention_metadata_for_sources,
    prepare_mentions_for_workspace,
    sync_mentions_for_source,
)
from .workspace_service import get_profiles, require_workspace_access, utc_now_iso

DECISION_COLUMNS = (
    "id,workspace_id,title,description,decision_reason,status,source_message_id,"
    "source_channel_id,initiative_id,created_by,created_at,updated_at"
)
TASK_PREVIEW_COLUMNS = "id,title,status,owner_user_id"
INITIATIVE_PREVIEW_COLUMNS = "id,title,status,momentum_state"
DECISION_STATUSES = ("proposed", "accepted", "rejected", "superseded")
logger = logging.getLogger(__name__)


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


async def _hydrate_decisions(rows: list[dict[str, Any]], expand_links: bool = False) -> list[dict[str, Any]]:
    mentions_by_source: dict[str, list[dict[str, Any]]] = {}
    workspace_ids = sorted({str(row.get("workspace_id")) for row in rows if row.get("workspace_id")})
    for workspace_id in workspace_ids:
        source_ids = [str(row.get("id")) for row in rows if str(row.get("workspace_id") or "") == workspace_id and row.get("id")]
        mentions_by_source.update(
            await mention_metadata_for_sources(
                workspace_id=workspace_id,
                source_type="decision",
                source_ids=source_ids,
            )
        )
    creator_ids = sorted({str(row.get("created_by")) for row in rows if row.get("created_by")})
    profiles = await get_profiles(creator_ids)
    hydrated: list[dict[str, Any]] = []
    for row in rows:
        creator = profiles.get(str(row.get("created_by") or ""), {})
        item = {
            **row,
            "creator_name": creator.get("full_name") or creator.get("handle") or creator.get("email"),
            "creator_email": creator.get("email"),
            "creator_avatar_label": creator.get("avatar_label"),
            "mentions": mentions_by_source.get(str(row.get("id")), []),
            "linked_tasks": [],
            "initiative": None,
        }

        if expand_links:
            workspace_id = row.get("workspace_id")
            # Fetch linked tasks
            try:
                link_filters: dict[str, Any] = {"decision_id": row["id"]}
                if workspace_id:
                    link_filters["workspace_id"] = workspace_id
                task_links = await select_all_trusted(
                    "workspace_decision_tasks",
                    "task_id",
                    link_filters,
                )
                if task_links:
                    task_ids = [str(tl["task_id"]) for tl in task_links]
                    task_filters: dict[str, Any] = {"id": task_ids}
                    if workspace_id:
                        task_filters["workspace_id"] = workspace_id
                    tasks = await select_all_trusted(
                        "workspace_tasks",
                        TASK_PREVIEW_COLUMNS,
                        task_filters,
                    )
                    item["linked_tasks"] = tasks
            except SupabaseServiceError:
                logger.warning("Decision linked task hydration failed | decision_id=%s", row.get("id"), exc_info=True)

            # Fetch initiative
            if row.get("initiative_id"):
                try:
                    initiative_filters: dict[str, Any] = {"id": row["initiative_id"]}
                    if workspace_id:
                        initiative_filters["workspace_id"] = workspace_id
                    initiative = await select_one_trusted(
                        "workspace_initiatives",
                        INITIATIVE_PREVIEW_COLUMNS,
                        initiative_filters,
                    )
                    item["initiative"] = initiative
                except SupabaseServiceError:
                    logger.warning("Decision initiative hydration failed | decision_id=%s", row.get("id"), exc_info=True)

        hydrated.append(item)
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
    return (await _hydrate_decisions([row], expand_links=True))[0]


async def update_decision_status(
    *,
    workspace_id: str,
    decision_id: str,
    user_id: str,
    status: str,
) -> dict[str, Any]:
    await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)
    timestamp = utc_now_iso()
    try:
        updated = await update_one_trusted(
            "workspace_decisions",
            {"id": decision_id, "workspace_id": workspace_id},
            {"status": _normalize_status(status), "updated_at": timestamp},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if updated is None:
        raise _not_found()

    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="decision.status_updated",
        summary=f"Decision status updated to {status}: {updated.get('title')}.",
        metadata={"decision_id": decision_id, "status": status},
    )
    return (await _hydrate_decisions([updated], expand_links=True))[0]


async def link_task_to_decision(
    *,
    workspace_id: str,
    decision_id: str,
    task_id: str,
    user_id: str,
) -> dict[str, Any]:
    await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)
    # Verify task exists in workspace
    try:
        task = await select_one_trusted("workspace_tasks", "id", {"id": task_id, "workspace_id": workspace_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in this workspace.")

    try:
        await insert_one_trusted(
            "workspace_decision_tasks",
            {"decision_id": decision_id, "task_id": task_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        # Check if already linked (Pkey violation)
        if "duplicate key" not in str(exc).lower():
            raise _database_error() from exc

    return await get_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)


async def unlink_task_from_decision(
    *,
    workspace_id: str,
    decision_id: str,
    task_id: str,
    user_id: str,
) -> dict[str, Any]:
    await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)
    try:
        await delete_one_trusted(
            "workspace_decision_tasks",
            {"decision_id": decision_id, "task_id": task_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return await get_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)


async def link_initiative_to_decision(
    *,
    workspace_id: str,
    decision_id: str,
    initiative_id: str | None,
    user_id: str,
) -> dict[str, Any]:
    await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)

    if initiative_id:
        # Verify initiative exists
        try:
            init = await select_one_trusted("workspace_initiatives", "id", {"id": initiative_id, "workspace_id": workspace_id})
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if not init:
            raise HTTPException(status_code=404, detail="Initiative not found in this workspace.")

    timestamp = utc_now_iso()
    try:
        updated = await update_one_trusted(
            "workspace_decisions",
            {"id": decision_id, "workspace_id": workspace_id},
            {"initiative_id": initiative_id, "updated_at": timestamp},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if updated is None:
        raise _not_found()

    return (await _hydrate_decisions([updated], expand_links=True))[0]


async def create_decision(
    *,
    workspace_id: str,
    user_id: str,
    payload: Mapping[str, Any],
    origin: str = "manual",
    source_channel_id: str | None = None,
    source_message_id: str | None = None,
) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    title = _clean_text(payload.get("title"))
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision title cannot be empty.")
    mentions = await prepare_mentions_for_workspace(
        workspace=access.workspace,
        mentions=payload.get("mentions"),
    )

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
    await sync_mentions_for_source(
        workspace_id=workspace_id,
        mentioned_by_user_id=user_id,
        source_type="decision",
        source_id=str(created["id"]),
        mentions=mentions,
    )
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
