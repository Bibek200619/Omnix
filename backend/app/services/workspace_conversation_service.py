from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException, status

from .supabase_service import (
    SupabaseServiceError,
    insert_one_trusted,
    select_all_trusted,
    select_one_trusted,
)
from .workspace_mention_service import (
    mention_metadata_for_sources,
    prepare_mentions_for_workspace,
    sync_mentions_for_source,
)
from .workspace_service import (
    get_profiles,
    list_workspace_members,
    normalize_operational_label,
    require_workspace_access,
    utc_now_iso,
)

logger = logging.getLogger(__name__)

CHANNEL_COLUMNS = (
    "id,workspace_id,created_by,name,slug,purpose,channel_type,visibility,"
    "posting_policy,is_archived,message_count,last_message_preview,last_message_at,created_at,updated_at"
)
MESSAGE_COLUMNS = (
    "id,workspace_id,channel_id,author_user_id,parent_message_id,content,"
    "context_links,metadata,client_nonce,created_at,updated_at,edited_at"
)
CHANNEL_MEMBER_COLUMNS = "channel_id,user_id,role,created_at"
DEFAULT_CHANNELS = (
    {
        "name": "announcements",
        "slug": "announcements",
        "purpose": "Durable operational updates and decisions that orient the workspace.",
        "channel_type": "announcement",
        "posting_policy": "leaders",
    },
    {
        "name": "general",
        "slug": "general",
        "purpose": "Shared operational coordination for this workspace.",
        "channel_type": "operational",
        "posting_policy": "members",
    },
)
LEADER_ROLES = {"founder", "owner", "co_owner", "team_lead", "sub_leader", "super_founder"}
MESSAGE_LIST_LIMIT = 100


def _ambient_role_label(role: Any) -> str | None:
    normalized = str(role or "").strip().lower().replace("-", "_")
    return {
        "super_founder": "Founder",
        "founder": "Founder",
        "owner": "Founder",
        "co_owner": "Operational Lead",
        "sub_leader": "Operational Lead",
        "team_lead": "Team Lead",
    }.get(normalized)


def _author_identity(member: Mapping[str, Any] | None) -> dict[str, str | None] | None:
    if member is None:
        return None
    role_label = _ambient_role_label(member.get("role"))
    operational_label = normalize_operational_label(member.get("operational_label"))
    labels = [label for label in (role_label, operational_label) if label]
    if not labels:
        return None
    return {
        "role_label": role_label,
        "operational_label": operational_label,
        "display_label": " \u2022 ".join(labels),
    }


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def channel_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:64] or "discussion"


def _preview(content: Any) -> str | None:
    if not isinstance(content, str):
        return None
    normalized = " ".join(content.split())
    if not normalized:
        return None
    return normalized if len(normalized) <= 110 else f"{normalized[:107].rstrip()}..."


async def ensure_default_channels(workspace_id: str, user_id: str) -> None:
    try:
        existing = await select_all_trusted(
            "workspace_channels",
            "slug",
            filters={"workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    existing_slugs = {str(channel.get("slug")) for channel in existing}
    for channel in DEFAULT_CHANNELS:
        if channel["slug"] in existing_slugs:
            continue
        try:
            await insert_one_trusted(
                "workspace_channels",
                {
                    "workspace_id": workspace_id,
                    "created_by": None,
                    "visibility": "workspace",
                    "is_archived": False,
                    **channel,
                },
            )
        except SupabaseServiceError as exc:
            try:
                concurrently_created = await select_one_trusted(
                    "workspace_channels",
                    "id",
                    {"workspace_id": workspace_id, "slug": channel["slug"]},
                )
            except SupabaseServiceError:
                concurrently_created = None
            if concurrently_created is None:
                raise _database_error() from exc
            # Multiple first loads may seed concurrently; the unique slug constraint is authoritative.
            logger.info("Default channel already seeded concurrently | workspace_id=%s | slug=%s", workspace_id, channel["slug"])


async def _require_channel_access(
    *,
    workspace_id: str,
    channel_id: str,
    user_id: str,
) -> tuple[dict[str, Any], Any]:
    access = await require_workspace_access(workspace_id, user_id)
    try:
        channel = await select_one_trusted(
            "workspace_channels",
            CHANNEL_COLUMNS,
            {"id": channel_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if channel is None or channel.get("is_archived") is True:
        raise _not_found("Conversation channel not found.")

    if channel.get("visibility") != "workspace":
        try:
            membership = await select_one_trusted(
                "workspace_channel_members",
                CHANNEL_MEMBER_COLUMNS,
                {"channel_id": channel_id, "user_id": user_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if membership is None and str(channel.get("created_by") or "") != user_id:
            raise _not_found("Conversation channel not found.")
    return channel, access


async def list_channels(*, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    await require_workspace_access(workspace_id, user_id)
    await ensure_default_channels(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "workspace_channels",
            CHANNEL_COLUMNS,
            filters={"workspace_id": workspace_id, "is_archived": False},
            order_by="created_at",
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    visible: list[dict[str, Any]] = []
    for channel in rows:
        if channel.get("visibility") == "workspace":
            visible.append(channel)
            continue
        try:
            membership = await select_one_trusted(
                "workspace_channel_members",
                CHANNEL_MEMBER_COLUMNS,
                {"channel_id": str(channel["id"]), "user_id": user_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if membership is not None or str(channel.get("created_by") or "") == user_id:
            visible.append(channel)

    visible.sort(key=lambda row: (row.get("channel_type") != "announcement", row.get("name", "").lower()))
    return visible


async def create_channel(
    *,
    workspace_id: str,
    user_id: str,
    payload: Mapping[str, Any],
    role: str,
) -> dict[str, Any]:
    if role not in LEADER_ROLES:
        raise _forbidden("Only workspace leads can create operational channels.")
    slug = channel_slug(str(payload.get("name") or ""))
    try:
        existing = await select_one_trusted(
            "workspace_channels",
            CHANNEL_COLUMNS,
            {"workspace_id": workspace_id, "slug": slug},
        )
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A channel with this name already exists.")
        return await insert_one_trusted(
            "workspace_channels",
            {
                "workspace_id": workspace_id,
                "created_by": user_id,
                "name": str(payload["name"]).strip(),
                "slug": slug,
                "purpose": payload.get("purpose"),
                "channel_type": payload.get("channel_type", "operational"),
                "visibility": "workspace",
                "posting_policy": payload.get("posting_policy", "members"),
                "is_archived": False,
            },
        )
    except HTTPException:
        raise
    except SupabaseServiceError as exc:
        raise _database_error() from exc


async def _hydrate_messages(
    rows: list[dict[str, Any]],
    workspace: dict[str, Any],
    reply_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    message_ids = [str(row.get("id")) for row in rows if row.get("id")]
    mentions_by_source = await mention_metadata_for_sources(
        workspace_id=str(workspace.get("id") or ""),
        source_type="conversation_message",
        source_ids=message_ids,
    )
    members = await list_workspace_members(workspace)
    members_by_user_id = {
        str(member.get("user_id")): member for member in members if member.get("user_id")
    }
    author_ids = {str(row.get("author_user_id")) for row in rows if row.get("author_user_id")}
    missing_author_ids = sorted(author_ids - set(members_by_user_id))
    profiles = await get_profiles(missing_author_ids)
    reply_counts: dict[str, int] = {}
    for row in reply_rows if reply_rows is not None else rows:
        parent_id = str(row.get("parent_message_id") or "")
        if parent_id:
            reply_counts[parent_id] = reply_counts.get(parent_id, 0) + 1

    hydrated: list[dict[str, Any]] = []
    for row in rows:
        user_id = str(row.get("author_user_id") or "")
        member = members_by_user_id.get(user_id)
        profile = member or profiles.get(user_id, {})
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        metadata_mentions = metadata.get("mentions") if isinstance(metadata.get("mentions"), list) else []
        mentions = mentions_by_source.get(str(row.get("id"))) or metadata_mentions
        hydrated.append(
            {
                **row,
                "context_links": row.get("context_links") if isinstance(row.get("context_links"), list) else [],
                "metadata": metadata,
                "mentions": mentions,
                "author_name": profile.get("full_name") or profile.get("handle"),
                "author_email": profile.get("email"),
                "author_avatar_url": profile.get("avatar_url"),
                "author_avatar_label": profile.get("avatar_label") or (user_id[:1].upper() if user_id else "U"),
                "author_identity": _author_identity(member),
                "thread_reply_count": reply_counts.get(str(row.get("id")), 0),
            }
        )
    return hydrated


async def _ensure_mentions_can_read_channel(
    *,
    channel: Mapping[str, Any],
    mention_user_ids: list[str],
) -> None:
    if not mention_user_ids or channel.get("visibility") == "workspace":
        return

    channel_id = str(channel.get("id") or "")
    try:
        members = await select_all_trusted(
            "workspace_channel_members",
            "channel_id,user_id",
            filters={"channel_id": channel_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    allowed_user_ids = {str(channel.get("created_by") or "")}
    allowed_user_ids.update(str(member.get("user_id")) for member in members if member.get("user_id"))
    blocked = [user_id for user_id in mention_user_ids if user_id not in allowed_user_ids]
    if blocked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mentions in private conversations must target channel members.",
        )


async def list_messages(
    *,
    workspace_id: str,
    channel_id: str,
    user_id: str,
    limit: int,
    offset: int,
    thread_root_id: str | None = None,
) -> list[dict[str, Any]]:
    _, access = await _require_channel_access(workspace_id=workspace_id, channel_id=channel_id, user_id=user_id)
    query_limit = min(max(limit, 1), MESSAGE_LIST_LIMIT)
    if thread_root_id:
        try:
            root = await select_one_trusted(
                "workspace_channel_messages",
                MESSAGE_COLUMNS,
                {"id": thread_root_id, "channel_id": channel_id, "workspace_id": workspace_id},
            )
            replies = await select_all_trusted(
                "workspace_channel_messages",
                MESSAGE_COLUMNS,
                filters={"channel_id": channel_id, "workspace_id": workspace_id, "parent_message_id": thread_root_id},
                order_by="created_at",
                limit=query_limit,
                offset=offset,
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if root is None or root.get("parent_message_id"):
            raise _not_found("Thread message not found.")
        selected = [root, *replies]
        return await _hydrate_messages(selected, access.workspace, replies)
    else:
        try:
            roots = await select_all_trusted(
                "workspace_channel_messages",
                MESSAGE_COLUMNS,
                filters={"channel_id": channel_id, "workspace_id": workspace_id, "parent_message_id": {"is": None}},
                order_by="created_at",
                desc=True,
                limit=query_limit,
                offset=offset,
            )
            replies = await select_all_trusted(
                "workspace_channel_messages",
                "id,parent_message_id",
                filters={"channel_id": channel_id, "workspace_id": workspace_id},
                limit=1000,
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        roots.reverse()
        return await _hydrate_messages(roots, access.workspace, replies)


async def create_message(
    *,
    workspace_id: str,
    channel_id: str,
    user_id: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    channel, access = await _require_channel_access(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=user_id,
    )
    if channel.get("posting_policy") == "leaders" and access.role not in LEADER_ROLES:
        raise _forbidden("Only workspace leads can publish in this channel.")

    parent_message_id = payload.get("parent_message_id")
    if parent_message_id:
        try:
            parent = await select_one_trusted(
                "workspace_channel_messages",
                MESSAGE_COLUMNS,
                {"id": str(parent_message_id), "workspace_id": workspace_id, "channel_id": channel_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if parent is None:
            raise _not_found("Thread message not found.")
        if parent.get("parent_message_id"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Replies must attach to the thread origin.")

    client_nonce = str(payload.get("client_nonce") or "").strip() or None
    if client_nonce:
        try:
            existing = await select_one_trusted(
                "workspace_channel_messages",
                MESSAGE_COLUMNS,
                {"channel_id": channel_id, "author_user_id": user_id, "client_nonce": client_nonce},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if existing is not None:
            return (await _hydrate_messages([existing], access.workspace))[0]

    mentions = await prepare_mentions_for_workspace(
        workspace=access.workspace,
        mentions=payload.get("mentions"),
    )
    await _ensure_mentions_can_read_channel(
        channel=channel,
        mention_user_ids=[str(mention["user_id"]) for mention in mentions],
    )
    timestamp = utc_now_iso()
    try:
        created = await insert_one_trusted(
            "workspace_channel_messages",
            {
                "workspace_id": workspace_id,
                "channel_id": channel_id,
                "author_user_id": user_id,
                "parent_message_id": parent_message_id,
                "content": str(payload["content"]).strip(),
                "context_links": list(payload.get("context_links") or []),
                "metadata": {"mentions": mentions} if mentions else {},
                "client_nonce": client_nonce,
                "created_at": timestamp,
                "updated_at": timestamp,
            },
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    await sync_mentions_for_source(
        workspace_id=workspace_id,
        mentioned_by_user_id=user_id,
        source_type="conversation_message",
        source_id=str(created["id"]),
        mentions=mentions,
    )
    return (await _hydrate_messages([created], access.workspace))[0]


async def channel_transcript_for_assistance(
    *,
    workspace_id: str,
    channel_id: str,
    user_id: str,
    thread_root_id: str | None,
    limit: int = 60,
    offset: int = 0,
) -> list[dict[str, Any]]:
    query_limit = min(max(limit, 1), MESSAGE_LIST_LIMIT)
    query_offset = max(offset, 0)
    if thread_root_id:
        return await list_messages(
            workspace_id=workspace_id,
            channel_id=channel_id,
            user_id=user_id,
            limit=query_limit,
            offset=query_offset,
            thread_root_id=thread_root_id,
        )
    _, access = await _require_channel_access(workspace_id=workspace_id, channel_id=channel_id, user_id=user_id)
    try:
        messages = await select_all_trusted(
            "workspace_channel_messages",
            MESSAGE_COLUMNS,
            filters={"workspace_id": workspace_id, "channel_id": channel_id},
            order_by="created_at",
            desc=True,
            limit=query_limit,
            offset=query_offset,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    messages.reverse()
    return await _hydrate_messages(messages, access.workspace)
