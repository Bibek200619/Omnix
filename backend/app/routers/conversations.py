from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..core.security import get_current_user
from ..schemas.chat import (
    ConversationCreate,
    ConversationHistoryRead,
    ConversationRead,
    ConversationUpdate,
)
from ..services.supabase_service import SupabaseServiceError, insert_one, select_all, select_one, update_one

router = APIRouter(prefix="/conversations", tags=["conversations"])
CONVERSATION_COLUMNS = "id,user_id,title,is_archived,created_at,updated_at,last_message_at"
MESSAGE_PREVIEW_COLUMNS = "id,conversation_id,user_id,role,content,status,created_at"
DEFAULT_CONVERSATION_LIMIT = 50
MAX_CONVERSATION_LIMIT = 100
MAX_HISTORY_MESSAGE_LOOKBACK = 1000
PREVIEW_LENGTH = 140


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


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
) -> list[dict[str, Any]]:
    conversation_ids = [str(item["id"]) for item in conversations if item.get("id")]
    if not conversation_ids:
        return _merge_latest_message_previews(conversations, [])

    try:
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


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation: ConversationCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    payload = {
        "user_id": user_id,
        "is_archived": False,
        **conversation.model_dump(exclude_none=True),
    }

    try:
        return await insert_one("conversations", payload)
    except SupabaseServiceError as exc:
        raise _database_error() from exc


@router.get("", response_model=list[ConversationHistoryRead])
async def get_conversations(
    limit: int = Query(default=DEFAULT_CONVERSATION_LIMIT, ge=1, le=MAX_CONVERSATION_LIMIT),
    offset: int = Query(default=0, ge=0),
    include_archived: bool = Query(default=False),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)

    try:
        conversations = await select_all(
            "conversations",
            CONVERSATION_COLUMNS,
            filters={"user_id": user_id},
            order_by="last_message_at",
            desc=True,
            limit=limit,
            offset=offset,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if not include_archived:
        conversations = [
            conversation
            for conversation in conversations
            if conversation.get("is_archived") is not True
        ]

    return await hydrate_conversation_history(conversations, user_id)


@router.get("/{conversation_id}", response_model=ConversationRead)
async def get_conversation(
    conversation_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)

    try:
        conversation = await select_one(
            "conversations",
            CONVERSATION_COLUMNS,
            {"id": conversation_id, "user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found.",
        )
    return conversation


@router.patch("/{conversation_id}", response_model=ConversationRead)
async def update_conversation(
    conversation_id: str,
    conversation: ConversationUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    payload = conversation.model_dump(exclude_none=True)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No updatable fields were provided.",
        )

    payload["updated_at"] = _utc_now_iso()

    try:
        updated_conversation = await update_one(
            "conversations",
            {"id": conversation_id, "user_id": user_id},
            payload,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if updated_conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found.",
        )
    return updated_conversation
