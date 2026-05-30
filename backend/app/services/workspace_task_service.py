from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any

from fastapi import HTTPException, status

from .supabase_service import (
    SupabaseServiceError,
    insert_one_trusted,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)
from .workspace_collaboration_service import log_workspace_activity
from .workspace_conversation_service import MESSAGE_COLUMNS, _require_channel_access
from .workspace_service import get_profiles, list_workspace_members, require_workspace_access, utc_now_iso

TASK_COLUMNS = (
    "id,workspace_id,title,description,status,owner_user_id,created_by,due_date,blockers,"
    "linked_context,activity_metadata,momentum_metadata,initiative_id,client_nonce,"
    "completed_at,created_at,updated_at"
)
TASK_STATUSES = ("idea", "planned", "active", "review", "complete")
DECISION_PREVIEW_COLUMNS = "id,title,status,decision_reason,created_at"
logger = logging.getLogger(__name__)


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _title_from_text(content: Any) -> str:
    normalized = " ".join(str(content or "").split())
    if not normalized:
        return "Follow through on discussion"
    return normalized if len(normalized) <= 110 else f"{normalized[:107].rstrip()}..."


def _normalize_blockers(blockers: Any) -> list[str]:
    if not isinstance(blockers, list):
        return []
    normalized: list[str] = []
    for blocker in blockers:
        text = _clean_text(blocker)
        if text and text not in normalized:
            normalized.append(text[:280])
    return normalized[:12]


def _normalize_links(links: Any) -> list[dict[str, Any]]:
    if not isinstance(links, list):
        return []
    normalized: list[dict[str, Any]] = []
    for link in links:
        if isinstance(link, Mapping):
            normalized.append(dict(link))
    return normalized[:12]


def _serialize_supabase_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {key: _serialize_supabase_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize_supabase_value(item) for item in value]
    if isinstance(value, tuple):
        return [_serialize_supabase_value(item) for item in value]
    return value


def _serialize_supabase_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {key: _serialize_supabase_value(value) for key, value in payload.items()}


async def _hydrate_tasks(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = sorted(
        {
            str(user_id)
            for row in rows
            for user_id in (row.get("owner_user_id"), row.get("created_by"))
            if user_id
        }
    )
    profiles = await get_profiles(ids)
    hydrated: list[dict[str, Any]] = []
    for row in rows:
        owner = profiles.get(str(row.get("owner_user_id") or ""), {})
        creator = profiles.get(str(row.get("created_by") or ""), {})

        # Fetch linked decisions
        linked_decisions = []
        try:
            decision_links = await select_all_trusted(
                "workspace_decision_tasks",
                "decision_id",
                {"task_id": row["id"], "workspace_id": row["workspace_id"]},
            )
            if decision_links:
                decision_ids = [str(dl["decision_id"]) for dl in decision_links]
                decisions = await select_all_trusted(
                    "workspace_decisions",
                    DECISION_PREVIEW_COLUMNS,
                    {"id": decision_ids, "workspace_id": row["workspace_id"]},
                )
                linked_decisions = decisions
        except SupabaseServiceError:
            logger.warning("Task linked decision hydration failed | task_id=%s", row.get("id"), exc_info=True)

        hydrated.append(
            {
                **row,
                "blockers": _normalize_blockers(row.get("blockers")),
                "linked_context": _normalize_links(row.get("linked_context")),
                "activity_metadata": row.get("activity_metadata") if isinstance(row.get("activity_metadata"), dict) else {},
                "momentum_metadata": row.get("momentum_metadata") if isinstance(row.get("momentum_metadata"), dict) else {},
                "owner_name": owner.get("full_name") or owner.get("handle"),
                "owner_email": owner.get("email"),
                "owner_avatar_label": owner.get("avatar_label"),
                "creator_name": creator.get("full_name") or creator.get("handle") or creator.get("email"),
                "linked_decisions": linked_decisions,
            }
        )
    return hydrated


async def _validate_owner(access: Any, owner_user_id: str | None) -> None:
    if not owner_user_id:
        return
    members = await list_workspace_members(access.workspace)
    if owner_user_id not in {str(member.get("user_id")) for member in members}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task ownership must be assigned to a visible workspace member.",
        )


async def _validate_initiative(workspace_id: str, initiative_id: str | None) -> None:
    if not initiative_id:
        return
    try:
        initiative = await select_one_trusted(
            "workspace_initiatives",
            "id",
            {"id": initiative_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if initiative is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Linked initiative must belong to this workspace.",
        )


async def list_tasks(*, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    await require_workspace_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "workspace_tasks",
            TASK_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="updated_at",
            desc=True,
            limit=300,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    return await _hydrate_tasks(rows)


async def require_task(*, workspace_id: str, task_id: str, user_id: str) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    try:
        row = await select_one_trusted(
            "workspace_tasks",
            TASK_COLUMNS,
            {"id": task_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if row is None:
        raise _not_found()
    return row


async def create_task(
    *,
    workspace_id: str,
    user_id: str,
    payload: Mapping[str, Any],
    origin: str = "manual",
) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    owner_user_id = _clean_text(payload.get("owner_user_id"))
    initiative_id = _clean_text(payload.get("initiative_id"))
    await _validate_owner(access, owner_user_id)
    await _validate_initiative(workspace_id, initiative_id)
    client_nonce = _clean_text(payload.get("client_nonce"))
    if client_nonce:
        try:
            existing = await select_one_trusted(
                "workspace_tasks",
                TASK_COLUMNS,
                {"workspace_id": workspace_id, "created_by": user_id, "client_nonce": client_nonce},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if existing is not None:
            return (await _hydrate_tasks([existing]))[0]

    task_status = str(payload.get("status") or "idea")
    timestamp = utc_now_iso()
    record = {
        "workspace_id": workspace_id,
        "title": str(payload["title"]).strip(),
        "description": _clean_text(payload.get("description")),
        "status": task_status,
        "owner_user_id": owner_user_id,
        "created_by": user_id,
        "due_date": payload.get("due_date"),
        "blockers": _normalize_blockers(payload.get("blockers")),
        "linked_context": _normalize_links(payload.get("linked_context")),
        "activity_metadata": {"origin": origin},
        "momentum_metadata": {},
        "initiative_id": initiative_id,
        "client_nonce": client_nonce,
        "completed_at": timestamp if task_status == "complete" else None,
        "updated_at": timestamp,
    }
    try:
        created = await insert_one_trusted("workspace_tasks", _serialize_supabase_payload(record))
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="task.created",
        summary=f"Task opened: {record['title']}.",
        metadata={"task_id": created.get("id"), "status": task_status, "origin": origin},
    )
    return (await _hydrate_tasks([created]))[0]


async def update_task(
    *,
    workspace_id: str,
    task_id: str,
    user_id: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    current = await require_task(workspace_id=workspace_id, task_id=task_id, user_id=user_id)
    access = await require_workspace_access(workspace_id, user_id)
    update: dict[str, Any] = {}
    for field in ("title", "description", "status", "due_date", "initiative_id"):
        if field in payload:
            update[field] = payload[field]
    if "title" in update:
        update["title"] = _clean_text(update["title"])
        if not update["title"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task title cannot be empty.")
    if "status" in update and not update["status"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task status cannot be empty.")
    if "description" in update:
        update["description"] = _clean_text(update["description"])
    if "initiative_id" in update:
        update["initiative_id"] = _clean_text(update["initiative_id"])
        await _validate_initiative(workspace_id, update["initiative_id"])
    if "owner_user_id" in payload:
        update["owner_user_id"] = _clean_text(payload.get("owner_user_id"))
        await _validate_owner(access, update["owner_user_id"])
    if "blockers" in payload:
        update["blockers"] = _normalize_blockers(payload.get("blockers"))
    if "linked_context" in payload:
        update["linked_context"] = _normalize_links(payload.get("linked_context"))

    next_status = str(update.get("status") or current.get("status") or "idea")
    if next_status == "complete" and current.get("status") != "complete":
        update["completed_at"] = utc_now_iso()
    elif next_status != "complete" and current.get("completed_at"):
        update["completed_at"] = None
    update["updated_at"] = utc_now_iso()

    try:
        changed = await update_one_trusted(
            "workspace_tasks",
            {"id": task_id, "workspace_id": workspace_id},
            _serialize_supabase_payload(update),
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if changed is None:
        raise _not_found()

    metadata: dict[str, Any] = {"task_id": task_id}
    summary = f"Task updated: {changed.get('title') or current.get('title')}."
    event_type = "task.updated"
    if current.get("status") != changed.get("status"):
        event_type = "task.status_changed"
        metadata["from_status"] = current.get("status")
        metadata["to_status"] = changed.get("status")
        summary = f"Task moved to {str(changed.get('status')).capitalize()}: {changed.get('title')}."
    elif current.get("owner_user_id") != changed.get("owner_user_id"):
        event_type = "task.assignment_changed"
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type=event_type,
        summary=summary,
        metadata=metadata,
    )
    return (await _hydrate_tasks([changed]))[0]


async def create_task_from_message(
    *,
    workspace_id: str,
    channel_id: str,
    message_id: str,
    user_id: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    channel, _ = await _require_channel_access(
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
    task_payload = {
        **payload,
        "title": _clean_text(payload.get("title")) or _title_from_text(source_content),
        "description": _clean_text(payload.get("description")) or source_content,
        "linked_context": [
            {
                "context_type": "conversation_message",
                "context_id": message_id,
                "label": "Source discussion",
                "metadata": {"channel_id": channel_id},
            },
            {
                "context_type": "channel",
                "context_id": channel_id,
                "label": str(channel.get("name") or "Conversation"),
                "metadata": {},
            },
        ],
    }
    return await create_task(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=task_payload,
        origin="conversation_message",
    )


async def create_task_from_assistance(
    *,
    workspace_id: str,
    channel_id: str,
    user_id: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    channel, _ = await _require_channel_access(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=user_id,
    )
    assistance_text = str(payload.get("assistance_text") or "").strip()
    task_payload = {
        **payload,
        "description": _clean_text(payload.get("description")) or assistance_text,
        "linked_context": [
            {
                "context_type": "ai_action_extraction",
                "context_id": channel_id,
                "label": "Selected action extraction",
                "metadata": {"thread_root_id": payload.get("thread_root_id")},
            },
            {
                "context_type": "channel",
                "context_id": channel_id,
                "label": str(channel.get("name") or "Conversation"),
                "metadata": {},
            },
        ],
    }
    return await create_task(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=task_payload,
        origin="ai_action_extraction",
    )


async def task_momentum(*, workspace_id: str, user_id: str) -> dict[str, Any]:
    tasks = await list_tasks(workspace_id=workspace_id, user_id=user_id)
    flow_counts = {task_status: 0 for task_status in TASK_STATUSES}
    today = date.today()
    due_threshold = today + timedelta(days=7)
    blocked_count = due_soon_count = overdue_count = unassigned_count = 0
    for task in tasks:
        task_status = str(task.get("status") or "idea")
        if task_status in flow_counts:
            flow_counts[task_status] += 1
        if task_status == "complete":
            continue
        if task.get("blockers"):
            blocked_count += 1
        if not task.get("owner_user_id"):
            unassigned_count += 1
        due_value = task.get("due_date")
        if isinstance(due_value, str):
            due_value = date.fromisoformat(due_value)
        if isinstance(due_value, date):
            if due_value < today:
                overdue_count += 1
            elif due_value <= due_threshold:
                due_soon_count += 1
    total_count = len(tasks)
    complete_count = flow_counts["complete"]
    open_count = total_count - complete_count
    if total_count == 0:
        health = "quiet"
        summary = "No operational tasks are recorded in this workspace."
    elif open_count == 0:
        health = "complete"
        summary = "Every recorded task is marked complete."
    elif blocked_count:
        health = "blocked"
        summary = f"{blocked_count} open task{'s are' if blocked_count != 1 else ' is'} explicitly blocked."
    else:
        health = "moving"
        summary = f"{open_count} open task{'s are' if open_count != 1 else ' is'} moving without recorded blockers."
    return {
        "workspace_id": workspace_id,
        "total_count": total_count,
        "open_count": open_count,
        "complete_count": complete_count,
        "blocked_count": blocked_count,
        "due_soon_count": due_soon_count,
        "overdue_count": overdue_count,
        "unassigned_count": unassigned_count,
        "flow_counts": flow_counts,
        "completion_ratio": round(complete_count / total_count, 3) if total_count else 0,
        "health": health,
        "summary": summary,
        "calculated_at": datetime.now(timezone.utc).isoformat(),
    }


async def task_transcript_for_assistance(*, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    return (await list_tasks(workspace_id=workspace_id, user_id=user_id))[:80]
