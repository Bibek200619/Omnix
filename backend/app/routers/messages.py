from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
import logging
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi import StreamingResponse, Request

from ..db.supabase import get_supabase
from starlette.concurrency import run_in_threadpool
from ..core.security import get_current_user
from ..schemas.chat import ChatRequest, ChatResponse, MessageRead
from ..services.chat_service import ModelServiceError, call_llm
from ..services.chat_service import call_llm_stream
from ..services.supabase_service import SupabaseServiceError, insert_many, insert_one, select_all, select_one, update_one
from .conversations import build_conversation_title, hydrate_conversation_history

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
            conversation_payload = {
                "user_id": user_id,
                "title": payload.title or build_conversation_title(message_text),
                "is_archived": False,
                "last_message_at": user_message_timestamp,
                "updated_at": user_message_timestamp,
            }
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
                "created_at": user_message_timestamp,
            },
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "assistant",
                "content": "",
                "status": "pending",
                "created_at": _utc_now_iso(),
            }
        ]
        
        inserted_messages = await insert_many("messages", messages_to_insert)
        user_message = inserted_messages[0]
        assistant_message = inserted_messages[1]
        
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    # --- KEYWORD RETRIEVAL INTEGRATION ---
    prompt_message = message_text
    sources = []
    try:
        from ..rag.keyword_retrieval import KeywordRetriever
        from ..rag.context_builder import ContextBuilder
        
        retriever = KeywordRetriever()
        context_builder = ContextBuilder()
        
        # Use conversation_id if available to scope keyword retrieval
        chunks = await retriever.retrieve(message_text, user_id=user_id, conversation_id=conversation_id, top_k=5)
        
        if chunks:
            chunk_texts = [c["content"] for c in chunks]
            prompt_message = context_builder.build_context(message_text, chunk_texts)
            
            # Build rich source metadata for UI consumption
            for c in chunks:
                    try:
                        score_val = float(c.get("score", 0.0))
                    except Exception:
                        score_val = 0.0
                    preview = (c.get("content") or "")[:200]
                    sources.append({
                        "id": c.get("chunk_id"),
                        "title": c.get("file_name", "Unknown File"),
                        "excerpt": f"[Score: {score_val:.2f}] " + preview[:100] + ("..." if len(preview) > 100 else ""),
                        "score": score_val,
                        "chunk_index": c.get("chunk_index"),
                        "file_id": c.get("file_id"),
                        "chunk_preview": preview,
                    })
            
    except Exception as e:
        logger.exception("Failed to retrieve chunks for context: %s", e)
    # ---------------------------------------

    try:
        assistant_response = await call_llm(
            prompt_message,
            context=_build_context(recent_messages),
            temperature=payload.temperature,
        )
    except ModelServiceError as exc:
        failed_at = _utc_now_iso()
        try:
            await asyncio.gather(
                update_one(
                    "messages",
                    {"id": assistant_message["id"], "user_id": user_id},
                    {"status": "failed"},
                ),
                update_one(
                    "conversations",
                    {"id": conversation_id, "user_id": user_id},
                    {"last_message_at": failed_at, "updated_at": failed_at},
                ),
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
        conversation["last_message_at"] = timestamp
        conversation["updated_at"] = timestamp
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    hydrated_conversation = (
        await hydrate_conversation_history([conversation], user_id)
    )[0]

    return ChatResponse(
        conversation_id=conversation_id,
        user_message_id=str(user_message["id"]),
        assistant_message_id=str(completed_assistant_message["id"]),
        response=assistant_response,
        sources=sources,
        conversation=hydrated_conversation,
        user_message=user_message,
        assistant_message=completed_assistant_message,
    )


@router.post("/chat/stream")
async def chat_stream(request: Request, payload: ChatRequest, current_user: dict[str, Any] = Depends(get_current_user)):
    """Stream assistant responses as server-sent events (SSE).

    Emits JSON payloads with the following envelope in `data`:
      { type: 'init'|'status'|'token'|'done'|'error', ... }
    """
    user_id = _user_id_from_claims(current_user)
    _check_rate_limit(user_id)

    message_text = payload.message.strip()
    if not message_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty.")

    # Create conversation / messages (same as non-stream endpoint)
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
            conversation_payload = {
                "user_id": user_id,
                "title": payload.title or build_conversation_title(message_text),
                "is_archived": False,
                "last_message_at": _utc_now_iso(),
                "updated_at": _utc_now_iso(),
            }
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
                "created_at": _utc_now_iso(),
            },
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "assistant",
                "content": "",
                "status": "pending",
                "created_at": _utc_now_iso(),
            },
        ]

        inserted_messages = await insert_many("messages", messages_to_insert)
        user_message = inserted_messages[0]
        assistant_message = inserted_messages[1]
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    # Retrieval for context (keyword retriever)
    prompt_message = message_text
    sources: list[dict[str, Any]] = []
    chunks = []
    try:
        from ..rag.keyword_retrieval import KeywordRetriever
        from ..rag.context_builder import ContextBuilder

        retriever = KeywordRetriever()
        context_builder = ContextBuilder()
        chunks = await retriever.retrieve(message_text, user_id=user_id, conversation_id=conversation_id, top_k=5)
        if chunks:
            chunk_texts = [c["content"] for c in chunks]
            prompt_message = context_builder.build_context(message_text, chunk_texts)
            for c in chunks:
                sources.append({
                    "id": c.get("chunk_id"),
                    "title": c.get("file_name", "Unknown File"),
                    "excerpt": (c.get("content") or "")[:120],
                    "score": c.get("score", 0.0),
                    "chunk_index": c.get("chunk_index"),
                })
    except Exception as exc:
        logger.exception("Failed to retrieve chunks for streaming context: %s", exc)

    async def event_generator() -> AsyncIterator[str]:
        # Initial event with metadata
        init_payload = {
            "type": "init",
            "conversation_id": conversation_id,
            "user_message_id": str(user_message.get("id")),
            "assistant_message_id": str(assistant_message.get("id")),
            "sources": sources,
        }
        yield f"data: {json.dumps(init_payload)}\n\n"

        # Notify retrieval status
        yield f"data: {json.dumps({"type": "status", "status": "retrieved", "count": len(sources)})}\n\n"

        # Stream tokens from the LLM
        try:
            async for token in call_llm_stream(prompt_message, context=_build_context(recent_messages), temperature=payload.temperature):
                # Check client disconnect
                if await request.is_disconnected():
                    logger.info("Client disconnected during streaming.")
                    break
                payload_chunk = {"type": "token", "text": token}
                yield f"data: {json.dumps(payload_chunk)}\n\n"

        except ModelServiceError as exc:
            err = {"type": "error", "detail": str(exc)}
            yield f"data: {json.dumps(err)}\n\n"
            # mark assistant message failed
            try:
                await update_one(
                    "messages",
                    {"id": assistant_message["id"], "user_id": user_id},
                    {"status": "failed"},
                )
            except Exception:
                logger.exception("Failed to mark streaming assistant message as failed.")
            return

        # Finalize: update assistant message content and mark as completed
        try:
            # Fetch the final assembled content from the database could be optional; here we update with placeholder
            await update_one(
                "messages",
                {"id": assistant_message["id"], "user_id": user_id},
                {"status": "completed"},
            )
        except Exception:
            logger.exception("Failed to mark streaming assistant message as completed.")

        done_payload = {"type": "done", "conversation_id": conversation_id}
        yield f"data: {json.dumps(done_payload)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
