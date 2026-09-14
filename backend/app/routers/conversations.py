from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from ..core.security import get_current_user
from ..schemas.chat import (
    ConversationCreate,
    ConversationHistoryRead,
    ConversationRead,
    ConversationUpdate,
)
from ..services.supabase_service import (
    SupabaseServiceError,
    insert_one,
    select_all,
    select_all_trusted,
    select_one_trusted,
    update_one,
    update_one_trusted,
)
from ..services.workspace_service import (
    can_manage_workspace_resource,
    require_active_workspace_access,
    require_workspace_access,
    utc_now_iso,
)
from ..services.workspace_common import WorkspaceAccess

router = APIRouter(prefix="/conversations", tags=["conversations"])
logger = logging.getLogger(__name__)
CONVERSATION_COLUMNS = "id,user_id,workspace_id,title,is_archived,created_at,updated_at,last_message_at"
CONVERSATION_LOCATOR_COLUMNS = "id,user_id,workspace_id"
MESSAGE_PREVIEW_COLUMNS = "id,conversation_id,user_id,role,content,status,created_at"
DEFAULT_CONVERSATION_LIMIT = 50
MAX_CONVERSATION_LIMIT = 100
MAX_HISTORY_MESSAGE_LOOKBACK = 1000
PREVIEW_LENGTH = 140


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


def _conversation_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Conversation not found.",
    )


def _conversation_scope_filters(
    conversation_id: str,
    user_id: str,
    workspace_access: WorkspaceAccess | None,
) -> dict[str, Any]:
    if workspace_access is not None:
        return {
            "id": conversation_id,
            "workspace_id": workspace_access.workspace_id,
        }
    return {
        "id": conversation_id,
        "user_id": user_id,
        "workspace_id": {"is": None},
    }


def build_conversation_title(message: str) -> str:
    normalized = " ".join(message.strip().split())
    if not normalized:
        return "New conversation"
    if len(normalized) <= 72:
        return normalized
    return f"{normalized[:69].rstrip()}..."


def _message_preview(content: str | None) -> str | None:
    if not content:
        return None
    normalized = " ".join(content.strip().split())
    if not normalized:
        return None
    if len(normalized) <= PREVIEW_LENGTH:
        return normalized
    return f"{normalized[: PREVIEW_LENGTH - 3].rstrip()}..."


def _merge_latest_message_previews(
    conversations: list[dict[str, Any]],
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    latest_by_conversation: dict[str, dict[str, Any]] = {}

    for message in messages:
        conversation_id = str(message.get("conversation_id") or "")
        if not conversation_id or conversation_id in latest_by_conversation:
            continue

        status_value = message.get("status")
        if status_value not in (None, "completed", "failed"):
            continue

        latest_by_conversation[conversation_id] = message

    hydrated: list[dict[str, Any]] = []
    for conversation in conversations:
        item = dict(conversation)
        latest_message = latest_by_conversation.get(str(item.get("id")))

        item["preview"] = None
        item["latest_message_role"] = None
        item["latest_message_at"] = item.get("last_message_at")

        if latest_message is not None:
            item["preview"] = _message_preview(latest_message.get("content"))
            item["latest_message_role"] = latest_message.get("role")
            item["latest_message_at"] = latest_message.get("created_at")

        hydrated.append(item)

    return hydrated


async def hydrate_conversation_history(
    conversations: list[dict[str, Any]],
    user_id: str,
    workspace_id: str | None = None,
) -> list[dict[str, Any]]:
    conversation_ids = [str(item["id"]) for item in conversations if item.get("id")]
    if not conversation_ids:
        return _merge_latest_message_previews(conversations, [])

    try:
        if workspace_id:
            messages = await select_all_trusted(
                "messages",
                MESSAGE_PREVIEW_COLUMNS,
                filters={"conversation_id": conversation_ids},
                order_by="created_at",
                desc=True,
                limit=MAX_HISTORY_MESSAGE_LOOKBACK,
            )
        else:
            messages = await select_all(
                "messages",
                MESSAGE_PREVIEW_COLUMNS,
                filters={"conversation_id": conversation_ids, "user_id": user_id},
                order_by="created_at",
                desc=True,
                limit=MAX_HISTORY_MESSAGE_LOOKBACK,
            )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return _merge_latest_message_previews(conversations, messages)


async def require_conversation_access(
    conversation_id: str,
    user_id: str,
) -> tuple[dict[str, Any], WorkspaceAccess | None]:
    try:
        locator = await select_one_trusted(
            "conversations",
            CONVERSATION_LOCATOR_COLUMNS,
            {"id": conversation_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if locator is None:
        raise _conversation_not_found()

    workspace_access: WorkspaceAccess | None = None
    workspace_id = locator.get("workspace_id")
    if workspace_id:
        try:
            workspace_access = await require_workspace_access(str(workspace_id), user_id)
        except HTTPException as exc:
            if exc.status_code in {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND}:
                raise _conversation_not_found() from exc
            raise
    elif str(locator.get("user_id") or "") != user_id:
        raise _conversation_not_found()

    try:
        conversation = await select_one_trusted(
            "conversations",
            CONVERSATION_COLUMNS,
            _conversation_scope_filters(conversation_id, user_id, workspace_access),
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if conversation is None:
        raise _conversation_not_found()

    return conversation, workspace_access


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation: ConversationCreate,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    workspace_access = await require_active_workspace_access(request, user_id)
    payload = {
        "user_id": user_id,
        "is_archived": False,
        **conversation.model_dump(exclude_none=True),
    }
    if workspace_access is not None:
        payload["workspace_id"] = workspace_access.workspace_id

    try:
        return await insert_one("conversations", payload)
    except SupabaseServiceError as exc:
        raise _database_error() from exc


@router.get("", response_model=list[ConversationHistoryRead])
async def get_conversations(
    request: Request,
    limit: int = Query(default=DEFAULT_CONVERSATION_LIMIT, ge=1, le=MAX_CONVERSATION_LIMIT),
    offset: int = Query(default=0, ge=0),
    include_archived: bool = Query(default=False),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    workspace_access = await require_active_workspace_access(request, user_id)

    try:
        if workspace_access is not None:
            conversations = await select_all_trusted(
                "conversations",
                CONVERSATION_COLUMNS,
                filters={"workspace_id": workspace_access.workspace_id},
                order_by="last_message_at",
                desc=True,
                limit=limit,
                offset=offset,
            )
        else:
            conversations = await select_all(
                "conversations",
                CONVERSATION_COLUMNS,
                filters={"user_id": user_id, "workspace_id": {"is": None}},
                order_by="last_message_at",
                desc=True,
                limit=limit,
                offset=offset,
            )
    except SupabaseServiceError:
        # Fail gracefully for list endpoints to avoid crashing frontends
        logger.exception("Failed to query conversations; returning empty list instead of 500.")
        return []

    if not include_archived:
        conversations = [
            conversation
            for conversation in conversations
            if conversation.get("is_archived") is not True
        ]

    return await hydrate_conversation_history(
        conversations,
        user_id,
        workspace_access.workspace_id if workspace_access is not None else None,
    )


@router.get("/{conversation_id}", response_model=ConversationRead)
async def get_conversation(
    conversation_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    conversation, _ = await require_conversation_access(conversation_id, user_id)
    return conversation


@router.patch("/{conversation_id}", response_model=ConversationRead)
async def update_conversation(
    conversation_id: str,
    conversation: ConversationUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    existing_conversation, workspace_access = await require_conversation_access(conversation_id, user_id)
    payload = conversation.model_dump(exclude_none=True)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No updatable fields were provided.",
        )

    if workspace_access is not None and not can_manage_workspace_resource(
        str(existing_conversation.get("user_id") or ""),
        workspace_access,
        user_id,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the creator or workspace owner can update this conversation.",
        )

    payload["updated_at"] = utc_now_iso()

    try:
        if workspace_access is not None:
            updated_conversation = await update_one_trusted(
                "conversations",
                _conversation_scope_filters(conversation_id, user_id, workspace_access),
                payload,
            )
        else:
            updated_conversation = await update_one(
                "conversations",
                _conversation_scope_filters(conversation_id, user_id, None),
                payload,
            )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if updated_conversation is None:
        raise _conversation_not_found()
    return updated_conversation
