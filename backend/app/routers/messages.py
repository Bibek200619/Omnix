from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..core.security import get_current_user
from ..schemas.chat import ChatRequest, ChatResponse, MessageRead
from ..services.chat_service import ModelServiceError, call_llm
from ..services.supabase_service import SupabaseServiceError, insert_many, insert_one, select_all, select_one, update_one

router = APIRouter(tags=["messages"])
logger = logging.getLogger(__name__)

RECENT_CONTEXT_LIMIT = 20
MAX_CONTEXT_CHARS = 16000
DEFAULT_MESSAGE_LIMIT = 50
MAX_MESSAGE_LIMIT = 100
MESSAGE_COLUMNS = "id,conversation_id,user_id,role,content,status,created_at"
MESSAGE_CONTEXT_COLUMNS = "role,content,status,created_at"
CONVERSATION_OWNERSHIP_COLUMNS = "id,user_id"

RATE_LIMIT_REQUESTS = 5
RATE_LIMIT_WINDOW = 60.0
_chat_rate_limits: dict[str, list[float]] = {}

def _check_rate_limit(user_id: str) -> None:
    now = time.time()
    history = _chat_rate_limits.get(user_id, [])
    history = [t for t in history if now - t < RATE_LIMIT_WINDOW]
    if len(history) >= RATE_LIMIT_REQUESTS:
        _chat_rate_limits[user_id] = history
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please try again later.",
        )
    history.append(now)
    _chat_rate_limits[user_id] = history


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


async def _require_conversation_owner(
    conversation_id: str,
    user_id: str,
) -> dict[str, Any]:
    try:
        conversation = await select_one(
            "conversations",
            CONVERSATION_OWNERSHIP_COLUMNS,
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


def _build_context(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    # Keep only the most recent context that fits within a fixed size budget.
    bounded_context: list[dict[str, str]] = []
    total_chars = 0

    for item in messages:
        role = item.get("role")
        content = item.get("content")
        message_status = item.get("status")
        if not isinstance(role, str) or not isinstance(content, str):
            continue

        normalized_content = content.strip()
        if not normalized_content:
            continue

        if message_status not in (None, "completed"):
            continue

        if total_chars + len(normalized_content) > MAX_CONTEXT_CHARS:
            break

        bounded_context.append({"role": role, "content": normalized_content})
        total_chars += len(normalized_content)

        if len(bounded_context) >= RECENT_CONTEXT_LIMIT:
            break

    return list(reversed(bounded_context))


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[MessageRead],
)
async def get_messages(
    conversation_id: str,
    limit: int = Query(default=DEFAULT_MESSAGE_LIMIT, ge=1, le=MAX_MESSAGE_LIMIT),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    await _require_conversation_owner(conversation_id, user_id)

    try:
        return await select_all(
            "messages",
            MESSAGE_COLUMNS,
            filters={"conversation_id": conversation_id, "user_id": user_id},
            order_by="created_at",
            limit=limit,
            offset=offset,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ChatResponse:
    user_id = _user_id_from_claims(current_user)
    _check_rate_limit(user_id)
    message_text = payload.message.strip()
    user_message_timestamp = _utc_now_iso()

    if not message_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty.",
        )

    try:
        if payload.conversation_id:
            conversation_id = payload.conversation_id
            conversation_task = _require_conversation_owner(conversation_id, user_id)
            recent_messages_task = select_all(
                "messages",
                MESSAGE_CONTEXT_COLUMNS,
                filters={"conversation_id": conversation_id, "user_id": user_id},
                order_by="created_at",
                desc=True,
                limit=RECENT_CONTEXT_LIMIT,
            )
            conversation, recent_messages = await asyncio.gather(conversation_task, recent_messages_task)
        else:
            conversation_payload = {"user_id": user_id, **({"title": payload.title} if payload.title else {})}
            conversation = await insert_one("conversations", conversation_payload)
            conversation_id = str(conversation["id"])
            recent_messages = []

        messages_to_insert = [
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "user",
                "content": message_text,
                "status": "completed",
            },
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "assistant",
                "content": "",
                "status": "pending",
            }
        ]
        
        inserted_messages = await insert_many("messages", messages_to_insert)
        user_message = inserted_messages[0]
        assistant_message = inserted_messages[1]
        
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    try:
        assistant_response = await call_llm(
            message_text,
            context=_build_context(recent_messages),
            temperature=payload.temperature,
        )
    except ModelServiceError as exc:
        try:
            await update_one(
                "messages",
                {"id": assistant_message["id"], "user_id": user_id},
                {"status": "failed"},
            )
        except SupabaseServiceError:
            logger.exception(
                "Failed to mark assistant message %s as failed.",
                assistant_message["id"],
            )
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    timestamp = _utc_now_iso()

    try:
        completed_assistant_message, _ = await asyncio.gather(
            update_one(
                "messages",
                {"id": assistant_message["id"], "user_id": user_id},
                {"content": assistant_response, "status": "completed"},
            ),
            update_one(
                "conversations",
                {"id": conversation_id, "user_id": user_id},
                {"last_message_at": timestamp, "updated_at": timestamp},
            )
        )
        if completed_assistant_message is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return ChatResponse(
        conversation_id=conversation_id,
        user_message_id=str(user_message["id"]),
        assistant_message_id=str(completed_assistant_message["id"]),
        response=assistant_response,
    )
