from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from starlette.responses import StreamingResponse

from ..core.security import get_current_user
from ..schemas.chat import ChatRequest, ChatResponse, MessageRead
from ..services.chat_service import ModelServiceError, call_llm, call_llm_stream
from ..services.supabase_service import (
    SupabaseServiceError,
    insert_many,
    insert_one,
    select_all,
    select_all_trusted,
    update_one,
    update_one_trusted,
)
from ..services.workspace_service import require_active_workspace_access, utc_now_iso
from .conversations import (
    build_conversation_title,
    hydrate_conversation_history,
    require_conversation_access,
)

router = APIRouter(tags=["messages"])
logger = logging.getLogger(__name__)

RECENT_CONTEXT_LIMIT = 20
MAX_CONTEXT_CHARS = 16000
DEFAULT_MESSAGE_LIMIT = 50
MAX_MESSAGE_LIMIT = 100
MESSAGE_COLUMNS = "id,conversation_id,user_id,role,content,status,created_at"
MESSAGE_CONTEXT_COLUMNS = "role,content,status,created_at"

RATE_LIMIT_REQUESTS = 5
RATE_LIMIT_WINDOW = 60.0
_chat_rate_limits: dict[str, list[float]] = {}


def _check_rate_limit(user_id: str) -> None:
    now = time.time()
    history = _chat_rate_limits.get(user_id, [])
    history = [timestamp for timestamp in history if now - timestamp < RATE_LIMIT_WINDOW]
    if len(history) >= RATE_LIMIT_REQUESTS:
        _chat_rate_limits[user_id] = history
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please try again later.",
        )
    history.append(now)
    _chat_rate_limits[user_id] = history


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


def _build_context(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
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


async def _load_recent_messages(
    conversation_id: str,
    user_id: str,
    workspace_id: str | None,
) -> list[dict[str, Any]]:
    try:
        if workspace_id:
            return await select_all_trusted(
                "messages",
                MESSAGE_CONTEXT_COLUMNS,
                filters={"conversation_id": conversation_id},
                order_by="created_at",
                desc=True,
                limit=RECENT_CONTEXT_LIMIT,
            )

        return await select_all(
            "messages",
            MESSAGE_CONTEXT_COLUMNS,
            filters={"conversation_id": conversation_id, "user_id": user_id},
            order_by="created_at",
            desc=True,
            limit=RECENT_CONTEXT_LIMIT,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc


async def _load_message_list(
    conversation_id: str,
    user_id: str,
    workspace_id: str | None,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    try:
        if workspace_id:
            return await select_all_trusted(
                "messages",
                MESSAGE_COLUMNS,
                filters={"conversation_id": conversation_id},
                order_by="created_at",
                limit=limit,
                offset=offset,
            )

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


async def _touch_conversation(
    conversation_id: str,
    user_id: str,
    workspace_id: str | None,
    payload: dict[str, Any],
) -> None:
    try:
        if workspace_id:
            await update_one_trusted("conversations", {"id": conversation_id}, payload)
        else:
            await update_one("conversations", {"id": conversation_id, "user_id": user_id}, payload)
    except SupabaseServiceError as exc:
        raise _database_error() from exc


def _build_sources(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for chunk in chunks:
        try:
            score_value = float(chunk.get("score", 0.0))
        except Exception:
            score_value = 0.0

        preview = (chunk.get("content") or "")[:200]
        sources.append(
            {
                "id": chunk.get("chunk_id"),
                "title": chunk.get("file_name", "Unknown File"),
                "excerpt": f"[Score: {score_value:.2f}] " + preview[:100] + ("..." if len(preview) > 100 else ""),
                "score": score_value,
                "chunk_index": chunk.get("chunk_index"),
                "file_id": chunk.get("file_id"),
                "chunk_preview": preview,
            }
        )
    return sources


async def _retrieve_prompt_context(
    message_text: str,
    user_id: str,
    conversation_id: str,
    workspace_id: str | None,
) -> tuple[str, list[dict[str, Any]]]:
    prompt_message = message_text
    chunks: list[dict[str, Any]] = []

    try:
        from ..rag.context_builder import ContextBuilder
        from ..rag.keyword_retrieval import KeywordRetriever

        retriever = KeywordRetriever()
        context_builder = ContextBuilder()
        chunks = await retriever.retrieve(
            message_text,
            user_id=user_id,
            conversation_id=conversation_id if workspace_id is None else None,
            workspace_id=workspace_id,
            top_k=5,
        )

        if chunks:
            prompt_message = context_builder.build_context(
                message_text,
                [chunk["content"] for chunk in chunks],
            )
    except Exception as exc:
        logger.exception("Failed to retrieve chunks for context: %s", exc)

    return prompt_message, _build_sources(chunks)


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
    conversation, workspace_access = await require_conversation_access(conversation_id, user_id)

    return await _load_message_list(
        conversation_id,
        user_id,
        str(conversation.get("workspace_id") or "") if workspace_access is not None else None,
        limit,
        offset,
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: Request,
    payload: ChatRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ChatResponse:
    user_id = _user_id_from_claims(current_user)
    _check_rate_limit(user_id)
    message_text = payload.message.strip()
    user_message_timestamp = utc_now_iso()

    if not message_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty.",
        )

    workspace_access = await require_active_workspace_access(request, user_id)
    conversation: dict[str, Any]
    workspace_id: str | None = None

    try:
        if payload.conversation_id:
            conversation_id = payload.conversation_id
            conversation, _ = await require_conversation_access(conversation_id, user_id)
            workspace_id = str(conversation.get("workspace_id") or "") or None
            recent_messages = await _load_recent_messages(conversation_id, user_id, workspace_id)
        else:
            conversation_payload = {
                "user_id": user_id,
                "title": payload.title or build_conversation_title(message_text),
                "is_archived": False,
                "last_message_at": user_message_timestamp,
                "updated_at": user_message_timestamp,
            }
            if workspace_access is not None:
                conversation_payload["workspace_id"] = workspace_access.workspace_id
                workspace_id = workspace_access.workspace_id

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
                "created_at": utc_now_iso(),
            },
        ]

        inserted_messages = await insert_many("messages", messages_to_insert)
        user_message = inserted_messages[0]
        assistant_message = inserted_messages[1]
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    prompt_message, sources = await _retrieve_prompt_context(
        message_text,
        user_id,
        conversation_id,
        workspace_id,
    )

    try:
        assistant_response = await call_llm(
            prompt_message,
            context=_build_context(recent_messages),
            temperature=payload.temperature,
        )
    except ModelServiceError as exc:
        failed_at = utc_now_iso()
        try:
            await asyncio.gather(
                update_one(
                    "messages",
                    {"id": assistant_message["id"], "user_id": user_id},
                    {"status": "failed"},
                ),
                _touch_conversation(
                    conversation_id,
                    user_id,
                    workspace_id,
                    {"last_message_at": failed_at, "updated_at": failed_at},
                ),
            )
        except Exception:
            logger.exception(
                "Failed to mark assistant message %s as failed.",
                assistant_message["id"],
            )
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    timestamp = utc_now_iso()

    try:
        completed_assistant_message, _ = await asyncio.gather(
            update_one(
                "messages",
                {"id": assistant_message["id"], "user_id": user_id},
                {"content": assistant_response, "status": "completed"},
            ),
            _touch_conversation(
                conversation_id,
                user_id,
                workspace_id,
                {"last_message_at": timestamp, "updated_at": timestamp},
            ),
        )
        if completed_assistant_message is None:
            raise _database_error()
        conversation["last_message_at"] = timestamp
        conversation["updated_at"] = timestamp
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    hydrated_conversation = (
        await hydrate_conversation_history([conversation], user_id, workspace_id)
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
async def chat_stream(
    request: Request,
    payload: ChatRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    user_id = _user_id_from_claims(current_user)
    _check_rate_limit(user_id)

    message_text = payload.message.strip()
    if not message_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty.")

    active_workspace_access = await require_active_workspace_access(request, user_id)
    workspace_id: str | None = None

    try:
        if payload.conversation_id:
            conversation_id = payload.conversation_id
            conversation, _ = await require_conversation_access(conversation_id, user_id)
            workspace_id = str(conversation.get("workspace_id") or "") or None
            recent_messages = await _load_recent_messages(conversation_id, user_id, workspace_id)
        else:
            created_at = utc_now_iso()
            conversation_payload = {
                "user_id": user_id,
                "title": payload.title or build_conversation_title(message_text),
                "is_archived": False,
                "last_message_at": created_at,
                "updated_at": created_at,
            }
            if active_workspace_access is not None:
                conversation_payload["workspace_id"] = active_workspace_access.workspace_id
                workspace_id = active_workspace_access.workspace_id

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
                "created_at": utc_now_iso(),
            },
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "assistant",
                "content": "",
                "status": "pending",
                "created_at": utc_now_iso(),
            },
        ]

        inserted_messages = await insert_many("messages", messages_to_insert)
        user_message = inserted_messages[0]
        assistant_message = inserted_messages[1]
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    prompt_message, sources = await _retrieve_prompt_context(
        message_text,
        user_id,
        conversation_id,
        workspace_id,
    )

    async def event_generator() -> AsyncIterator[str]:
        assistant_parts: list[str] = []

        init_payload = {
            "type": "init",
            "conversation_id": conversation_id,
            "user_message_id": str(user_message.get("id")),
            "assistant_message_id": str(assistant_message.get("id")),
            "sources": sources,
        }
        yield f"data: {json.dumps(init_payload)}\n\n"

        status_payload = {"type": "status", "status": "retrieved", "count": len(sources)}
        yield f"data: {json.dumps(status_payload)}\n\n"

        try:
            async for token in call_llm_stream(
                prompt_message,
                context=_build_context(recent_messages),
                temperature=payload.temperature,
            ):
                if await request.is_disconnected():
                    logger.info("Client disconnected during streaming.")
                    break

                assistant_parts.append(token)
                payload_chunk = {"type": "token", "text": token}
                yield f"data: {json.dumps(payload_chunk)}\n\n"
        except ModelServiceError as exc:
            err = {"type": "error", "detail": str(exc)}
            yield f"data: {json.dumps(err)}\n\n"
            try:
                await update_one(
                    "messages",
                    {"id": assistant_message["id"], "user_id": user_id},
                    {"status": "failed"},
                )
            except Exception:
                logger.exception("Failed to mark streaming assistant message as failed.")
            return
        except Exception as exc:
            logger.exception("Unexpected streaming error: %s", exc)
            err = {"type": "error", "detail": "Streaming failed unexpectedly."}
            yield f"data: {json.dumps(err)}\n\n"
            try:
                await update_one(
                    "messages",
                    {"id": assistant_message["id"], "user_id": user_id},
                    {"status": "failed"},
                )
            except Exception:
                logger.exception("Failed to mark unexpected streaming error state.")
            return

        final_content = "".join(assistant_parts)
        finished_at = utc_now_iso()

        try:
            await asyncio.gather(
                update_one(
                    "messages",
                    {"id": assistant_message["id"], "user_id": user_id},
                    {"content": final_content, "status": "completed"},
                ),
                _touch_conversation(
                    conversation_id,
                    user_id,
                    workspace_id,
                    {"last_message_at": finished_at, "updated_at": finished_at},
                ),
            )
        except Exception:
            logger.exception("Failed to finalize streaming assistant message.")

        done_payload = {"type": "done", "conversation_id": conversation_id}
        yield f"data: {json.dumps(done_payload)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
