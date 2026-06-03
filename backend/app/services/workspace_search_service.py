from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException, status

from .supabase_service import SupabaseServiceError, select_all_trusted, select_one_trusted
from .workspace_service import require_workspace_access

logger = logging.getLogger(__name__)

SEARCH_GROUP_LIMIT = 8
FIELD_QUERY_LIMIT = 8
CHANNEL_COLUMNS = (
    "id,workspace_id,created_by,name,purpose,visibility,is_archived,"
    "message_count,last_message_preview,last_message_at,created_at,updated_at"
)
MESSAGE_COLUMNS = "id,workspace_id,channel_id,content,created_at,updated_at"
TASK_COLUMNS = "id,workspace_id,title,description,status,created_at,updated_at"
INITIATIVE_COLUMNS = "id,workspace_id,title,description,status,created_at,updated_at"
DECISION_COLUMNS = "id,workspace_id,title,description,decision_reason,status,created_at,updated_at"
CHANNEL_MEMBER_COLUMNS = "channel_id,user_id,role,created_at"


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _normalize_query(query: str) -> str:
    return " ".join(str(query or "").split())[:120]


def _ilike_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _compact_text(value: Any, *, limit: int = 160) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split())
    if not normalized:
        return None
    return normalized if len(normalized) <= limit else f"{normalized[: limit - 3].rstrip()}..."


def _result_time(row: Mapping[str, Any]) -> str:
    return str(row.get("updated_at") or row.get("created_at") or "")


def _dedupe_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for result in sorted(results, key=_result_time, reverse=True):
        result_id = str(result.get("id") or "")
        if not result_id or result_id in seen:
            continue
        seen.add(result_id)
        unique.append(result)
        if len(unique) >= SEARCH_GROUP_LIMIT:
            break
    return unique


async def _search_table_fields(
    *,
    table: str,
    columns: str,
    workspace_id: str,
    fields: tuple[str, ...],
    pattern: str,
    extra_filters: Mapping[str, Any] | None = None,
    order_by: str = "updated_at",
) -> list[dict[str, Any]]:
    async def query_field(field: str) -> list[dict[str, Any]]:
        filters: dict[str, Any] = {
            "workspace_id": workspace_id,
            field: {"ilike": pattern},
        }
        if extra_filters:
            filters.update(extra_filters)
        rows = await select_all_trusted(
            table,
            columns,
            filters=filters,
            order_by=order_by,
            desc=True,
            limit=FIELD_QUERY_LIMIT,
        )
        return [{**row, "_matched_field": field} for row in rows]

    groups = await asyncio.gather(*(query_field(field) for field in fields))
    return [row for group in groups for row in group]


async def _visible_channels(workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    channels = await select_all_trusted(
        "workspace_channels",
        CHANNEL_COLUMNS,
        filters={"workspace_id": workspace_id, "is_archived": False},
        order_by="created_at",
    )
    visible: list[dict[str, Any]] = []
    for channel in channels:
        if channel.get("visibility") == "workspace":
            visible.append(channel)
            continue
        channel_id = str(channel.get("id") or "")
        if not channel_id:
            continue
        membership = await select_one_trusted(
            "workspace_channel_members",
            CHANNEL_MEMBER_COLUMNS,
            {"channel_id": channel_id, "user_id": user_id},
        )
        if membership is not None or str(channel.get("created_by") or "") == user_id:
            visible.append(channel)
    return visible


def _conversation_result_from_channel(row: Mapping[str, Any]) -> dict[str, Any]:
    channel_id = str(row["id"])
    return {
        "id": channel_id,
        "workspace_id": str(row["workspace_id"]),
        "type": "conversation",
        "title": str(row.get("name") or "Conversation"),
        "preview": _compact_text(row.get("last_message_preview") or row.get("purpose")),
        "context": "Workspace channel",
        "url": f"/conversations?channel={channel_id}",
        "channel_id": channel_id,
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at") or row.get("last_message_at"),
    }


def _conversation_result_from_message(
    row: Mapping[str, Any],
    channels_by_id: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any] | None:
    channel_id = str(row.get("channel_id") or "")
    channel = channels_by_id.get(channel_id)
    if channel is None:
        return None
    return {
        "id": channel_id,
        "workspace_id": str(row["workspace_id"]),
        "type": "conversation",
        "title": str(channel.get("name") or "Conversation"),
        "preview": _compact_text(row.get("content")),
        "context": "Message preview",
        "url": f"/conversations?channel={channel_id}",
        "channel_id": channel_id,
        "message_id": str(row.get("id") or "") or None,
        "matched_field": "message_preview",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def _search_conversations(workspace_id: str, user_id: str, pattern: str) -> list[dict[str, Any]]:
    channels = await _visible_channels(workspace_id, user_id)
    channel_ids = [str(channel["id"]) for channel in channels if channel.get("id")]
    if not channel_ids:
        return []

    channel_rows = await _search_table_fields(
        table="workspace_channels",
        columns=CHANNEL_COLUMNS,
        workspace_id=workspace_id,
        fields=("name", "last_message_preview"),
        pattern=pattern,
        extra_filters={"id": channel_ids, "is_archived": False},
    )
    message_rows = await _search_table_fields(
        table="workspace_channel_messages",
        columns=MESSAGE_COLUMNS,
        workspace_id=workspace_id,
        fields=("content",),
        pattern=pattern,
        extra_filters={"channel_id": channel_ids},
    )
    channels_by_id = {str(channel["id"]): channel for channel in channels if channel.get("id")}
    results = [_conversation_result_from_channel(row) for row in channel_rows]
    results.extend(
        result
        for row in message_rows
        if (result := _conversation_result_from_message(row, channels_by_id)) is not None
    )
    return _dedupe_results(results)


def _task_result(row: Mapping[str, Any]) -> dict[str, Any]:
    task_id = str(row["id"])
    return {
        "id": task_id,
        "workspace_id": str(row["workspace_id"]),
        "type": "task",
        "title": str(row.get("title") or "Untitled task"),
        "preview": _compact_text(row.get("description")),
        "context": str(row.get("status") or "Task").replace("_", " ").title(),
        "url": f"/tasks?id={task_id}",
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _initiative_result(row: Mapping[str, Any]) -> dict[str, Any]:
    initiative_id = str(row["id"])
    return {
        "id": initiative_id,
        "workspace_id": str(row["workspace_id"]),
        "type": "initiative",
        "title": str(row.get("title") or "Untitled initiative"),
        "preview": _compact_text(row.get("description")),
        "context": str(row.get("status") or "Initiative").replace("_", " ").title(),
        "url": f"/initiatives?id={initiative_id}",
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _decision_result(row: Mapping[str, Any]) -> dict[str, Any]:
    decision_id = str(row["id"])
    return {
        "id": decision_id,
        "workspace_id": str(row["workspace_id"]),
        "type": "decision",
        "title": str(row.get("title") or "Untitled decision"),
        "preview": _compact_text(row.get("decision_reason") or row.get("description")),
        "context": str(row.get("status") or "Decision").replace("_", " ").title(),
        "url": f"/decisions?id={decision_id}",
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def search_workspace(
    *,
    workspace_id: str,
    user_id: str,
    query: str,
) -> dict[str, list[dict[str, Any]]]:
    await require_workspace_access(workspace_id, user_id)
    normalized_query = _normalize_query(query)
    empty = {"conversations": [], "tasks": [], "initiatives": [], "decisions": []}
    if not normalized_query:
        return empty

    pattern = _ilike_pattern(normalized_query)
    try:
        conversations_task = _search_conversations(workspace_id, user_id, pattern)
        tasks_task = _search_table_fields(
            table="workspace_tasks",
            columns=TASK_COLUMNS,
            workspace_id=workspace_id,
            fields=("title", "description"),
            pattern=pattern,
        )
        initiatives_task = _search_table_fields(
            table="workspace_initiatives",
            columns=INITIATIVE_COLUMNS,
            workspace_id=workspace_id,
            fields=("title", "description"),
            pattern=pattern,
        )
        decisions_task = _search_table_fields(
            table="workspace_decisions",
            columns=DECISION_COLUMNS,
            workspace_id=workspace_id,
            fields=("title", "decision_reason", "description"),
            pattern=pattern,
        )
        conversation_rows, task_rows, initiative_rows, decision_rows = await asyncio.gather(
            conversations_task,
            tasks_task,
            initiatives_task,
            decisions_task,
        )
    except SupabaseServiceError as exc:
        logger.exception("Workspace search failed | workspace_id=%s", workspace_id)
        raise _database_error() from exc

    return {
        "conversations": conversation_rows,
        "tasks": _dedupe_results([_task_result(row) for row in task_rows]),
        "initiatives": _dedupe_results([_initiative_result(row) for row in initiative_rows]),
        "decisions": _dedupe_results([_decision_result(row) for row in decision_rows]),
    }
