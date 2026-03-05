from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..core.security import get_current_user
from ..schemas.chat import ConversationCreate, ConversationRead, ConversationUpdate
from ..services.supabase_service import SupabaseServiceError, insert_one, select_all, select_one, update_one

router = APIRouter(prefix="/conversations", tags=["conversations"])
CONVERSATION_COLUMNS = "id,user_id,title,archived,created_at,updated_at,last_message_at"
DEFAULT_CONVERSATION_LIMIT = 50
MAX_CONVERSATION_LIMIT = 100


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation: ConversationCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    payload = {"user_id": user_id, **conversation.model_dump(exclude_none=True)}

    try:
        return await insert_one("conversations", payload)
    except SupabaseServiceError as exc:
        raise _database_error() from exc


@router.get("", response_model=list[ConversationRead])
async def get_conversations(
    limit: int = Query(default=DEFAULT_CONVERSATION_LIMIT, ge=1, le=MAX_CONVERSATION_LIMIT),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)

    try:
        return await select_all(
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
