from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status

from .supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_one_trusted,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)
from .workspace_collaboration_service import log_workspace_activity
from .workspace_conversation_service import _require_channel_access, channel_transcript_for_assistance, list_channels
from .workspace_service import get_profiles, list_workspace_members, require_workspace_access, utc_now_iso
from .workspace_task_service import list_tasks, update_task

INITIATIVE_COLUMNS = (
    "id,workspace_id,title,description,status,owner_user_id,created_by,target_date,"
    "initiative_context,linked_resources,activity_metadata,completed_at,client_nonce,created_at,updated_at"
)
CHANNEL_LINK_COLUMNS = "initiative_id,workspace_id,channel_id,attached_by,created_at"


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found.")


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _normalize_resources(resources: Any) -> list[dict[str, Any]]:
    if not isinstance(resources, list):
        return []
    normalized: list[dict[str, Any]] = []
    for resource in resources:
        if isinstance(resource, Mapping):
            normalized.append(dict(resource))
    return normalized[:24]


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _momentum(initiative: Mapping[str, Any], tasks: list[dict[str, Any]], channels: list[dict[str, Any]]) -> dict[str, Any]:
    today = date.today()
    due_threshold = today + timedelta(days=7)
    open_tasks = [task for task in tasks if task.get("status") != "complete"]
    blocked_tasks = [task for task in open_tasks if task.get("blockers")]
    due_soon = overdue = 0
    for task in open_tasks:
        due_value = task.get("due_date")
        if isinstance(due_value, str):
            try:
                due_value = date.fromisoformat(due_value)
            except ValueError:
                due_value = None
        if isinstance(due_value, date):
            if due_value < today:
                overdue += 1
            elif due_value <= due_threshold:
                due_soon += 1
    movements = [
        timestamp
        for timestamp in (
            _as_datetime(initiative.get("updated_at")),
            *(_as_datetime(task.get("updated_at")) for task in tasks),
            *(_as_datetime(channel.get("last_message_at")) for channel in channels),
        )
        if timestamp is not None
    ]
    latest = max(movements) if movements else None
    is_dormant = bool(latest and datetime.now(timezone.utc) - latest > timedelta(days=14))
    status_value = str(initiative.get("status") or "draft")
    if status_value == "complete":
        health = "completion_flow"
        summary = "This initiative is marked complete."
    elif blocked_tasks:
        health = "blocked_execution"
        count = len(blocked_tasks)
        summary = f"{count} linked open task{'s have' if count != 1 else ' has'} explicitly recorded blockers."
    elif (tasks or channels) and is_dormant:
        health = "dormant"
        summary = "No linked task or conversation movement has been recorded in the last 14 days."
    elif open_tasks or channels:
        health = "active_movement"
        summary = f"{len(open_tasks)} open linked task{'s' if len(open_tasks) != 1 else ''} and {len(channels)} attached conversation{'s' if len(channels) != 1 else ''} are visible."
    else:
        health = "quiet"
        summary = "No execution records are linked to this initiative yet."
    return {
        "health": health,
        "summary": summary,
        "task_count": len(tasks),
        "open_task_count": len(open_tasks),
        "complete_task_count": len(tasks) - len(open_tasks),
        "blocked_task_count": len(blocked_tasks),
        "due_soon_count": due_soon,
        "overdue_count": overdue,
        "channel_count": len(channels),
        "discussion_message_count": sum(int(channel.get("message_count") or 0) for channel in channels),
        "last_movement_at": latest.isoformat() if latest else None,
    }


async def _validate_owner(workspace: dict[str, Any], owner_user_id: str | None) -> None:
    if not owner_user_id:
        return
    members = await list_workspace_members(workspace)
    if owner_user_id not in {str(member.get("user_id")) for member in members}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Initiative ownership must be assigned to a visible workspace member.",
        )


async def _base_records(workspace_id: str, user_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    tasks = await list_tasks(workspace_id=workspace_id, user_id=user_id)
    channels = await list_channels(workspace_id=workspace_id, user_id=user_id)
    try:
        links = await select_all_trusted(
            "workspace_initiative_channels",
            CHANNEL_LINK_COLUMNS,
            filters={"workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    return tasks, channels, links


async def _hydrate_initiatives(
    rows: list[dict[str, Any]],
    *,
    workspace_id: str,
    user_id: str,
) -> list[dict[str, Any]]:
    tasks, visible_channels, channel_links = await _base_records(workspace_id, user_id)
    channels_by_id = {str(channel["id"]): channel for channel in visible_channels}
    profiles = await get_profiles(
        sorted(
            {
                str(user_id_value)
                for row in rows
                for user_id_value in (row.get("owner_user_id"), row.get("created_by"))
                if user_id_value
            }
        )
    )
    hydrated: list[dict[str, Any]] = []
    for row in rows:
        initiative_id = str(row["id"])
        linked_tasks = [task for task in tasks if str(task.get("initiative_id") or "") == initiative_id]
        linked_channels = [
            channels_by_id[str(link["channel_id"])]
            for link in channel_links
            if str(link.get("initiative_id")) == initiative_id and str(link.get("channel_id")) in channels_by_id
        ]
        owner = profiles.get(str(row.get("owner_user_id") or ""), {})
        creator = profiles.get(str(row.get("created_by") or ""), {})
        hydrated.append(
            {
                **row,
                "linked_resources": _normalize_resources(row.get("linked_resources")),
                "activity_metadata": row.get("activity_metadata") if isinstance(row.get("activity_metadata"), dict) else {},
                "owner_name": owner.get("full_name") or owner.get("handle"),
                "owner_email": owner.get("email"),
                "owner_avatar_label": owner.get("avatar_label"),
                "creator_name": creator.get("full_name") or creator.get("handle") or creator.get("email"),
                "linked_tasks": linked_tasks,
                "linked_channels": linked_channels,
                "momentum": _momentum(row, linked_tasks, linked_channels),
            }
        )
    return hydrated


async def list_initiatives(*, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    await require_workspace_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "workspace_initiatives",
            INITIATIVE_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="updated_at",
            desc=True,
            limit=200,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    return await _hydrate_initiatives(rows, workspace_id=workspace_id, user_id=user_id)


async def require_initiative(*, workspace_id: str, initiative_id: str, user_id: str) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    try:
        row = await select_one_trusted(
            "workspace_initiatives",
            INITIATIVE_COLUMNS,
            {"id": initiative_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if row is None:
        raise _not_found()
    return row


async def get_initiative(*, workspace_id: str, initiative_id: str, user_id: str) -> dict[str, Any]:
    row = await require_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)
    return (await _hydrate_initiatives([row], workspace_id=workspace_id, user_id=user_id))[0]


async def create_initiative(*, workspace_id: str, user_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    owner_user_id = _clean_text(payload.get("owner_user_id"))
    await _validate_owner(access.workspace, owner_user_id)
    client_nonce = _clean_text(payload.get("client_nonce"))
    if client_nonce:
        try:
            existing = await select_one_trusted(
                "workspace_initiatives",
                INITIATIVE_COLUMNS,
                {"workspace_id": workspace_id, "created_by": user_id, "client_nonce": client_nonce},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if existing is not None:
            return (await _hydrate_initiatives([existing], workspace_id=workspace_id, user_id=user_id))[0]
    title = str(payload["title"]).strip()
    initiative_status = str(payload.get("status") or "draft")
    timestamp = utc_now_iso()
    record = {
        "workspace_id": workspace_id,
        "name": title,
        "title": title,
        "description": _clean_text(payload.get("description")),
        "status": initiative_status,
        "owner_user_id": owner_user_id,
        "created_by": user_id,
        "target_date": payload.get("target_date"),
        "initiative_context": _clean_text(payload.get("initiative_context")),
        "linked_resources": _normalize_resources(payload.get("linked_resources")),
        "activity_metadata": {"origin": "manual"},
        "client_nonce": client_nonce,
        "completed_at": timestamp if initiative_status == "complete" else None,
        "updated_at": timestamp,
    }
    try:
        created = await insert_one_trusted("workspace_initiatives", record)
        await insert_one_trusted(
            "workspace_operational_timeline",
            {
                "workspace_id": workspace_id,
                "initiative_id": created["id"],
                "event_type": "initiative_started",
                "summary": f"Initiative opened: {title}.",
                "metadata": {"actor_user_id": user_id, "initiative_name": title},
            },
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="initiative.created",
        summary=f"Initiative opened: {title}.",
        metadata={"initiative_id": created.get("id"), "status": initiative_status},
    )
    return (await _hydrate_initiatives([created], workspace_id=workspace_id, user_id=user_id))[0]


async def update_initiative(
    *,
    workspace_id: str,
    initiative_id: str,
    user_id: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    current = await require_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)
    access = await require_workspace_access(workspace_id, user_id)
    update: dict[str, Any] = {}
    for field in ("title", "description", "status", "target_date", "initiative_context"):
        if field in payload:
            update[field] = payload[field]
    if "title" in update:
        update["title"] = _clean_text(update["title"])
        if not update["title"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Initiative title cannot be empty.")
        update["name"] = update["title"]
    if "description" in update:
        update["description"] = _clean_text(update["description"])
    if "initiative_context" in update:
        update["initiative_context"] = _clean_text(update["initiative_context"])
    if "owner_user_id" in payload:
        update["owner_user_id"] = _clean_text(payload.get("owner_user_id"))
        await _validate_owner(access.workspace, update["owner_user_id"])
    if "linked_resources" in payload:
        update["linked_resources"] = _normalize_resources(payload.get("linked_resources"))
    next_status = str(update.get("status") or current.get("status") or "draft")
    if next_status == "complete" and current.get("status") != "complete":
        update["completed_at"] = utc_now_iso()
    elif next_status != "complete" and current.get("completed_at"):
        update["completed_at"] = None
    update["updated_at"] = utc_now_iso()
    try:
        changed = await update_one_trusted(
            "workspace_initiatives",
            {"id": initiative_id, "workspace_id": workspace_id},
            update,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if changed is None:
        raise _not_found()
    event_type = "initiative.updated"
    summary = f"Initiative updated: {changed.get('title')}."
    metadata: dict[str, Any] = {"initiative_id": initiative_id}
    if current.get("status") != changed.get("status"):
        event_type = "initiative.status_changed"
        metadata.update({"from_status": current.get("status"), "to_status": changed.get("status")})
        summary = f"Initiative moved to {str(changed.get('status')).replace('_', ' ').title()}: {changed.get('title')}."
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type=event_type,
        summary=summary,
        metadata=metadata,
    )
    return (await _hydrate_initiatives([changed], workspace_id=workspace_id, user_id=user_id))[0]


async def attach_task(*, workspace_id: str, initiative_id: str, task_id: str, user_id: str) -> dict[str, Any]:
    await require_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)
    await update_task(
        workspace_id=workspace_id,
        task_id=task_id,
        user_id=user_id,
        payload={"initiative_id": initiative_id},
    )
    return await get_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)


async def attach_channel(*, workspace_id: str, initiative_id: str, channel_id: str, user_id: str) -> dict[str, Any]:
    initiative = await require_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)
    await _require_channel_access(workspace_id=workspace_id, channel_id=channel_id, user_id=user_id)
    try:
        existing = await select_one_trusted(
            "workspace_initiative_channels",
            CHANNEL_LINK_COLUMNS,
            {"workspace_id": workspace_id, "initiative_id": initiative_id, "channel_id": channel_id},
        )
        if existing is None:
            await insert_one_trusted(
                "workspace_initiative_channels",
                {
                    "workspace_id": workspace_id,
                    "initiative_id": initiative_id,
                    "channel_id": channel_id,
                    "attached_by": user_id,
                },
            )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="initiative.conversation_attached",
        summary=f"Conversation attached to initiative: {initiative.get('title')}.",
        metadata={"initiative_id": initiative_id, "channel_id": channel_id},
    )
    return await get_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)


async def detach_channel(*, workspace_id: str, initiative_id: str, channel_id: str, user_id: str) -> dict[str, Any]:
    await require_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)
    try:
        await delete_many_trusted(
            "workspace_initiative_channels",
            {"workspace_id": workspace_id, "initiative_id": initiative_id, "channel_id": channel_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    return await get_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)


async def initiative_evidence_for_assistance(
    *, workspace_id: str, initiative_id: str, user_id: str
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    initiative = await get_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=user_id)
    messages: list[dict[str, Any]] = []
    for channel in initiative["linked_channels"][:8]:
        transcript = await channel_transcript_for_assistance(
            workspace_id=workspace_id,
            channel_id=str(channel["id"]),
            user_id=user_id,
            thread_root_id=None,
        )
        messages.extend(transcript[-20:])
    return initiative, messages[-80:]
