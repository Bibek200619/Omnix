from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

from fastapi import HTTPException, status

from ..db.supabase_client import get_async_supabase
from .supabase_service import SupabaseServiceError, select_all_trusted
from .workspace_access_service import require_workspace_access
from .workspace_membership_service import list_workspace_members
from .workspace_mention_service import list_mentions_for_user

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
CHANNEL_MEMBER_COLUMNS = "channel_id"
FILE_COLUMNS = (
    "id,workspace_id,user_id,file_name,file_type,size_bytes,processing_status,"
    "extraction_status,metadata,created_at,updated_at"
)
DOCUMENT_COLUMNS = "id,workspace_id,file_id,content,chunk_index,metadata,source_type,created_at,updated_at"
CONNECTOR_COLUMNS = (
    "id,workspace_id,connector_type,display_name,status,last_error,source_file_id,"
    "last_synced_at,created_at,updated_at"
)
SEARCH_GROUPS = (
    "conversations",
    "tasks",
    "initiatives",
    "decisions",
    "files",
    "documents",
    "sources",
    "automations",
    "activity",
    "jobs",
    "members",
    "mentions",
    "workspaces",
)
RANKED_SEARCH_RPC = "search_workspace_ranked"


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _ranked_search_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Workspace search is temporarily unavailable. Please try again.",
    )


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


def _result_rank(result: Mapping[str, Any], query: str) -> int:
    normalized_query = query.lower()
    title = str(result.get("title") or "").lower()
    preview = str(result.get("preview") or "").lower()
    context = str(result.get("context") or "").lower()
    matched_field = str(result.get("matched_field") or "").lower()
    if title == normalized_query:
        return 0
    if title.startswith(normalized_query):
        return 1
    if normalized_query in title:
        return 2
    if matched_field in {"title", "name", "file_name", "display_name"}:
        return 3
    if normalized_query in preview:
        return 4
    if normalized_query in context:
        return 5
    return 6


def _dedupe_results(results: list[dict[str, Any]], *, query: str = "", limit: int = SEARCH_GROUP_LIMIT) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    ordered = sorted(results, key=_result_time, reverse=True)
    if query:
        ordered.sort(key=lambda result: _result_rank(result, query))
    for result in ordered:
        result_id = str(result.get("id") or "")
        if not result_id or result_id in seen:
            continue
        seen.add(result_id)
        unique.append(result)
        if len(unique) >= limit:
            break
    return unique


async def _search_table_fields(
    *,
    table: str,
    columns: str,
    workspace_id: str,
    fields: tuple[str, ...],
    pattern: str,
    workspace_filter: str = "workspace_id",
    extra_filters: Mapping[str, Any] | None = None,
    order_by: str = "updated_at",
) -> list[dict[str, Any]]:
    async def query_field(field: str) -> list[dict[str, Any]]:
        filters: dict[str, Any] = {
            workspace_filter: workspace_id,
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
    private_channel_ids = [
        str(channel["id"])
        for channel in channels
        if channel.get("visibility") != "workspace" and channel.get("id")
    ]
    memberships = await select_all_trusted(
        "workspace_channel_members",
        CHANNEL_MEMBER_COLUMNS,
        filters={"channel_id": private_channel_ids, "user_id": user_id},
    ) if private_channel_ids else []
    member_channel_ids = {
        str(membership.get("channel_id") or "")
        for membership in memberships
        if membership.get("channel_id")
    }
    visible: list[dict[str, Any]] = []
    for channel in channels:
        if channel.get("visibility") == "workspace":
            visible.append(channel)
            continue
        channel_id = str(channel.get("id") or "")
        if not channel_id:
            continue
        if channel_id in member_channel_ids or str(channel.get("created_by") or "") == user_id:
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


async def _search_conversations(workspace_id: str, user_id: str, pattern: str, query: str) -> list[dict[str, Any]]:
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
    return _dedupe_results(results, query=query)


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


def _file_result(row: Mapping[str, Any]) -> dict[str, Any]:
    file_id = str(row["id"])
    status_text = str(row.get("processing_status") or row.get("extraction_status") or "File").replace("_", " ").title()
    file_type = str(row.get("file_type") or "").strip()
    size_bytes = row.get("size_bytes")
    size_context = f"{size_bytes} bytes" if size_bytes is not None else None
    return {
        "id": file_id,
        "workspace_id": str(row["workspace_id"]),
        "type": "file",
        "title": str(row.get("file_name") or "Workspace file"),
        "preview": file_type or size_context,
        "context": status_text,
        "url": f"/files?id={file_id}",
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _document_title(row: Mapping[str, Any]) -> str:
    metadata = row.get("metadata")
    if isinstance(metadata, Mapping):
        for key in ("file_name", "source_name", "title", "connector_name"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    chunk_index = row.get("chunk_index")
    if chunk_index is not None:
        return f"Document snippet {chunk_index}"
    return "Document snippet"


def _document_result(row: Mapping[str, Any]) -> dict[str, Any]:
    document_id = str(row["id"])
    file_id = str(row.get("file_id") or "")
    return {
        "id": document_id,
        "workspace_id": str(row["workspace_id"]),
        "type": "document",
        "title": _document_title(row),
        "preview": _compact_text(row.get("content"), limit=220),
        "context": str(row.get("source_type") or "Extracted document text").replace("_", " ").title(),
        "url": f"/files?id={file_id}" if file_id else "/files",
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _source_result(row: Mapping[str, Any]) -> dict[str, Any]:
    connector_id = str(row["id"])
    connector_type = str(row.get("connector_type") or "source").replace("_", " ").title()
    status_text = str(row.get("status") or "Source").replace("_", " ").title()
    return {
        "id": connector_id,
        "workspace_id": str(row["workspace_id"]),
        "type": "source",
        "title": str(row.get("display_name") or connector_type),
        "preview": _compact_text(row.get("last_error")) if row.get("last_error") else connector_type,
        "context": status_text,
        "url": f"/sources?source={connector_id}",
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at") or row.get("last_synced_at"),
    }


def _member_result(row: Mapping[str, Any]) -> dict[str, Any]:
    user_id = str(row.get("user_id") or "")
    title = str(row.get("full_name") or row.get("handle") or row.get("email") or "Workspace member")
    role = str(row.get("role") or "member").replace("_", " ").title()
    return {
        "id": user_id,
        "workspace_id": str(row.get("workspace_id") or ""),
        "type": "member",
        "title": title,
        "preview": _compact_text(row.get("operational_label") or row.get("email") or row.get("handle")),
        "context": role,
        "url": "/team",
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _mention_result(row: Mapping[str, Any]) -> dict[str, Any]:
    mention_id = str(row.get("id") or "")
    source_type = str(row.get("source_type") or "mention").replace("_", " ").title()
    actor = str(row.get("mentioned_by_name") or row.get("mentioned_by_email") or "A teammate")
    read_at = row.get("read_at")
    return {
        "id": mention_id,
        "workspace_id": str(row.get("workspace_id") or ""),
        "type": "mention",
        "title": str(row.get("source_title") or "Workspace mention"),
        "preview": _compact_text(row.get("source_preview") or f"{actor} mentioned you"),
        "context": f"{'Read' if read_at else 'Unread'} {source_type} mention",
        "url": str(row.get("source_url") or "/notifications"),
        "matched_field": row.get("_matched_field"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("created_at"),
    }


def _workspace_result(row: Mapping[str, Any], query: str) -> dict[str, Any] | None:
    haystack = " ".join(
        str(row.get(key) or "")
        for key in (
            "name",
            "description",
            "expertise_area",
            "workspace_focus",
            "ai_specialization",
        )
    ).lower()
    if query.lower() not in haystack:
        return None
    workspace_id = str(row.get("id") or "")
    return {
        "id": workspace_id,
        "workspace_id": workspace_id,
        "type": "workspace",
        "title": str(row.get("name") or "Workspace"),
        "preview": _compact_text(row.get("description") or row.get("expertise_area")),
        "context": str(row.get("workspace_focus") or row.get("workspace_type") or "Workspace").replace("_", " ").title(),
        "url": "/workspace",
        "matched_field": "workspace_metadata",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _empty_response() -> dict[str, Any]:
    response: dict[str, Any] = {group: [] for group in SEARCH_GROUPS}
    response["items"] = []
    response["pagination"] = {"limit": SEARCH_GROUP_LIMIT, "cursor": 0, "next_cursor": None}
    return response


def _group_for_result_type(result_type: str) -> str | None:
    return {
        "conversation": "conversations",
        "task": "tasks",
        "initiative": "initiatives",
        "decision": "decisions",
        "file": "files",
        "document": "documents",
        "source": "sources",
        "automation": "automations",
        "activity": "activity",
        "member": "members",
        "mention": "mentions",
        "workspace": "workspaces",
    }.get(result_type)


def _flatten_response(response: Mapping[str, Any], *, limit: int, cursor: int, ranked_count: int | None = None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for group in SEARCH_GROUPS:
        group_items = response.get(group)
        if isinstance(group_items, list):
            items.extend(group_items)
    next_cursor = cursor + limit if ranked_count is not None and ranked_count >= limit else None
    if isinstance(response, dict):
        response["items"] = items
        response["pagination"] = {"limit": limit, "cursor": cursor, "next_cursor": next_cursor}
    return items


async def _search_ranked_workspace(
    *,
    workspace_id: str,
    query: str,
    limit: int,
    cursor: int,
) -> list[dict[str, Any]] | None:
    try:
        client = await get_async_supabase()
        response = await client.rpc(
            RANKED_SEARCH_RPC,
            {
                "p_workspace_id": workspace_id,
                "p_query": query,
                "p_limit": limit,
                "p_offset": cursor,
            },
        ).execute()
        return list(getattr(response, "data", None) or [])
    except Exception:
        logger.warning("Ranked workspace search RPC unavailable")
        return None


def _ranked_result(row: Mapping[str, Any]) -> dict[str, Any] | None:
    result_type = str(row.get("type") or "")
    if _group_for_result_type(result_type) is None:
        return None
    result_id = str(row.get("id") or "")
    workspace_id = str(row.get("workspace_id") or "")
    title = str(row.get("title") or "").strip()
    url = _ranked_result_url(row, result_type=result_type, result_id=result_id)
    if not result_id or not workspace_id or not title or not url:
        return None
    return {
        "id": result_id,
        "workspace_id": workspace_id,
        "type": result_type,
        "title": title,
        "preview": _compact_text(row.get("preview"), limit=220),
        "context": _compact_text(row.get("context"), limit=160),
        "url": url,
        "channel_id": row.get("channel_id"),
        "message_id": row.get("message_id"),
        "matched_field": row.get("matched_field") or "full_text",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _ranked_result_url(
    row: Mapping[str, Any],
    *,
    result_type: str,
    result_id: str,
) -> str | None:
    destinations = {
        "task": ("/tasks", "id"),
        "initiative": ("/initiatives", "id"),
        "decision": ("/decisions", "id"),
        "file": ("/files", "id"),
        "source": ("/sources", "source"),
    }
    destination = destinations.get(result_type)
    if destination is not None and result_id:
        path, parameter = destination
        return f"{path}?{parameter}={quote(result_id, safe='')}"

    if result_type != "document" or not result_id:
        return None

    raw_url = str(row.get("url") or "").strip()
    parsed = urlsplit(raw_url)
    if parsed.scheme or parsed.netloc or parsed.fragment or parsed.path != "/files":
        return None
    try:
        query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        return None
    if set(query) - {"id", "document"}:
        return None
    file_ids = query.get("id", [])
    document_ids = query.get("document", [])
    if len(file_ids) != 1 or not file_ids[0]:
        return None
    if document_ids and document_ids != [result_id]:
        return None
    return (
        f"/files?id={quote(file_ids[0], safe='')}"
        f"&document={quote(result_id, safe='')}"
    )


def _group_ranked_results(rows: list[dict[str, Any]], *, query: str, limit: int) -> dict[str, Any]:
    grouped = _empty_response()
    for row in rows:
        result = _ranked_result(row)
        if result is None:
            continue
        group = _group_for_result_type(str(result["type"]))
        if group is None:
            continue
        grouped[group].append(result)

    for group in SEARCH_GROUPS:
        grouped[group] = _dedupe_results(grouped[group], query=query, limit=limit)
    return grouped


async def _search_members(workspace: Mapping[str, Any], query: str) -> list[dict[str, Any]]:
    members = await list_workspace_members(dict(workspace))
    normalized_query = query.lower()
    matches: list[dict[str, Any]] = []
    for member in members:
        fields = {
            "full_name": member.get("full_name"),
            "email": member.get("email"),
            "handle": member.get("handle"),
            "role": member.get("role"),
            "operational_label": member.get("operational_label"),
        }
        matched_field = next(
            (field for field, value in fields.items() if normalized_query in str(value or "").lower()),
            None,
        )
        if matched_field:
            matches.append({**member, "_matched_field": matched_field})
    return _dedupe_results([_member_result(row) for row in matches], query=query)


async def _search_mentions(workspace_id: str, user_id: str, query: str) -> list[dict[str, Any]]:
    mentions = await list_mentions_for_user(workspace_id=workspace_id, user_id=user_id, limit=50)
    normalized_query = query.lower()
    matches: list[dict[str, Any]] = []
    for mention in mentions:
        fields = {
            "source_title": mention.get("source_title"),
            "source_preview": mention.get("source_preview"),
            "mentioned_by_name": mention.get("mentioned_by_name"),
            "mentioned_by_email": mention.get("mentioned_by_email"),
            "source_type": mention.get("source_type"),
        }
        matched_field = next(
            (field for field, value in fields.items() if normalized_query in str(value or "").lower()),
            None,
        )
        if matched_field:
            matches.append({**mention, "_matched_field": matched_field})
    return _dedupe_results([_mention_result(row) for row in matches], query=query)


async def search_workspace(
    *,
    workspace_id: str,
    user_id: str,
    query: str,
    limit: int = SEARCH_GROUP_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    normalized_query = _normalize_query(query)
    empty = _empty_response()
    bounded_limit = max(1, min(int(limit), 25))
    bounded_cursor = max(0, int(cursor))
    empty["pagination"] = {"limit": bounded_limit, "cursor": bounded_cursor, "next_cursor": None}
    if not normalized_query:
        return empty

    pattern = _ilike_pattern(normalized_query)
    ranked_rows = await _search_ranked_workspace(
        workspace_id=workspace_id,
        query=normalized_query,
        limit=max(bounded_limit * 8, bounded_limit),
        cursor=bounded_cursor,
    )
    if ranked_rows is None:
        raise _ranked_search_unavailable()

    try:
        conversations_task = _search_conversations(workspace_id, user_id, pattern, normalized_query)
        members_task = _search_members(access.workspace, normalized_query)
        mentions_task = _search_mentions(workspace_id, user_id, normalized_query)
        conversation_rows, member_rows, mention_rows = await asyncio.gather(
            conversations_task,
            members_task,
            mentions_task,
        )
    except SupabaseServiceError as exc:
        logger.exception("Workspace search failed | workspace_id=%s", workspace_id)
        raise _database_error() from exc

    ranked_response = _group_ranked_results(ranked_rows, query=normalized_query, limit=bounded_limit)
    workspace_result = _workspace_result(access.workspace, normalized_query)
    ranked_response["conversations"] = conversation_rows
    ranked_response["members"] = member_rows
    ranked_response["mentions"] = mention_rows
    ranked_response["workspaces"] = [workspace_result] if workspace_result else []
    _flatten_response(ranked_response, limit=bounded_limit, cursor=bounded_cursor, ranked_count=len(ranked_rows))
    return ranked_response
