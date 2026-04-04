from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from starlette.responses import StreamingResponse

from ..core.security import get_current_user
from ..schemas.chat import AIGenerationRequest, AIGenerationResponse, ChatRequest, ChatResponse, MessageRead
from ..services.chat_service import (
    AIMessage,
    ModelServiceError,
    call_llm,
    call_llm_stream,
    generate_ai_response,
)
from ..services.document_context_service import build_uploaded_document_context
from ..services.supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_many,
    insert_one,
    select_all,
    select_all_trusted,
    select_one_trusted,
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

RECENT_CONTEXT_LIMIT = 4
MAX_CONTEXT_CHARS = 8000
DEFAULT_MESSAGE_LIMIT = 50
MAX_MESSAGE_LIMIT = 100
MESSAGE_COLUMNS = "id,conversation_id,user_id,role,content,status,created_at"
MESSAGE_CONTEXT_COLUMNS = "role,content,status,created_at"
FILE_COLUMNS = "id,user_id,workspace_id,conversation_id,file_name,file_type,metadata,created_at"

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


def _retrieval_debug_from_context(strategy: str, built_context: Any) -> dict[str, Any]:
    chunks = built_context.chunks if getattr(built_context, "chunks", None) else []
    sources = built_context.sources if getattr(built_context, "sources", None) else []
    first_chunk: dict[str, Any] = chunks[0] if chunks else {}
    first_source: dict[str, Any] = sources[0] if sources else {}
    preview = (
        first_chunk.get("content")
        or first_source.get("chunk_preview")
        or first_source.get("excerpt")
        or ""
    )

    return {
        "strategy": strategy,
        "retrieved_chunks_count": len(chunks) or len(sources),
        "first_chunk_preview": str(preview).replace("\n", " ")[:240],
        "diagnostics": getattr(built_context, "diagnostics", {}),
    }


def _empty_retrieval_debug(strategy: str = "none") -> dict[str, Any]:
    return {
        "strategy": strategy,
        "retrieved_chunks_count": 0,
        "first_chunk_preview": "",
        "diagnostics": {},
    }


def _log_ollama_prompt_debug(
    *,
    conversation_id: str,
    prompt: str,
    retrieval_debug: dict[str, Any],
) -> None:
    logger.info(
        "Ollama prompt debug: conversation_id=%s retrieval_strategy=%s retrieved_chunks_count=%d "
        "prompt_length=%d first_retrieved_chunk_preview=%r",
        conversation_id,
        retrieval_debug.get("strategy", "unknown"),
        int(retrieval_debug.get("retrieved_chunks_count") or 0),
        len(prompt or ""),
        retrieval_debug.get("first_chunk_preview") or "",
    )


async def _attach_files_to_conversation(
    attachment_ids: list[str],
    *,
    user_id: str,
    conversation_id: str,
    workspace_id: str | None,
) -> None:
    unique_attachment_ids = list(dict.fromkeys(str(item) for item in attachment_ids if item))
    if not unique_attachment_ids:
        return

    for file_id in unique_attachment_ids:
        try:
            file_row = await select_one_trusted("files", FILE_COLUMNS, {"id": file_id})
        except SupabaseServiceError as exc:
            raise _database_error() from exc

        if file_row is None:
            logger.warning("Skipping unknown attachment %s for conversation %s.", file_id, conversation_id)
            continue

        if workspace_id:
            if str(file_row.get("workspace_id") or "") != workspace_id:
                logger.warning(
                    "Skipping attachment %s because its workspace does not match conversation %s.",
                    file_id,
                    conversation_id,
                )
                continue

            try:
                await update_one_trusted(
                    "files",
                    {"id": file_id, "workspace_id": workspace_id},
                    {"conversation_id": conversation_id},
                )
            except SupabaseServiceError as exc:
                raise _database_error() from exc
            continue

        if str(file_row.get("user_id") or "") != user_id or file_row.get("workspace_id"):
            logger.warning(
                "Skipping attachment %s because it is outside the user's private scope.",
                file_id,
            )
            continue

        try:
            await update_one(
                "files",
                {"id": file_id, "user_id": user_id},
                {"conversation_id": conversation_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc


async def _retrieve_prompt_context(
    message_text: str,
    user_id: str,
    conversation_id: str,
    workspace_id: str | None,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    prompt_message = message_text

    try:
        uploaded_context = await build_uploaded_document_context(
            message_text,
            user_id=user_id,
            conversation_id=conversation_id,
            workspace_id=workspace_id,
        )
        if uploaded_context and uploaded_context.sources:
            return (
                uploaded_context.prompt,
                uploaded_context.sources,
                _retrieval_debug_from_context("uploaded_document", uploaded_context),
            )
    except Exception as exc:
        logger.exception("Uploaded document context retrieval failed for conversation %s: %s", conversation_id, exc)

    if not await _has_retrievable_documents(user_id=user_id, workspace_id=workspace_id):
        logger.info(
            "Skipping hybrid retrieval because no document chunks exist for conversation %s workspace_id=%s.",
            conversation_id,
            workspace_id,
        )
        return prompt_message, [], _empty_retrieval_debug("no_documents")

    try:
        from ..rag.startup import get_vector_store
        from ..retrieval.hybrid_search import HybridSearchEngine

        engine = HybridSearchEngine(get_vector_store())
        _, built_context = await engine.build_context(
            message_text,
            user_id=user_id,
            workspace_id=workspace_id,
        )

        if built_context.sources:
            return (
                built_context.prompt,
                built_context.sources,
                _retrieval_debug_from_context("hybrid", built_context),
            )
    except Exception as exc:
        logger.exception("Hybrid retrieval failed for conversation %s: %s", conversation_id, exc)

    return prompt_message, [], _empty_retrieval_debug()


async def _has_retrievable_documents(*, user_id: str, workspace_id: str | None) -> bool:
    try:
        if workspace_id:
            rows = await select_all_trusted(
                "documents",
                "id,workspace_id",
                filters={"workspace_id": workspace_id},
                limit=1,
            )
            return any(str(row.get("workspace_id") or "") == workspace_id for row in rows)

        rows = await select_all(
            "documents",
            "id,workspace_id",
            filters={"user_id": user_id},
            limit=1,
        )
        return any(not row.get("workspace_id") for row in rows)
    except Exception:
        logger.exception("Unable to check document availability; allowing hybrid retrieval fallback.")
        return True


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


@router.delete(
    "/conversations/{conversation_id}/messages",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def clear_messages(
    conversation_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    conversation, workspace_access = await require_conversation_access(conversation_id, user_id)
    workspace_id = str(conversation.get("workspace_id") or "") if workspace_access is not None else None

    try:
        await delete_many_trusted("messages", {"conversation_id": conversation_id})
        await _touch_conversation(
            conversation_id,
            user_id,
            workspace_id,
            {"last_message_at": utc_now_iso(), "updated_at": utc_now_iso()},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return None


@router.post("/ai/generate", response_model=AIGenerationResponse)
async def generate_ai(
    payload: AIGenerationRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> AIGenerationResponse:
    user_id = _user_id_from_claims(current_user)
    _check_rate_limit(user_id)

    try:
        generation = await generate_ai_response(
            payload.prompt,
            context=[
                AIMessage(role=message.role, content=message.content)
                for message in payload.context
            ],
            system_prompt=payload.system_prompt,
            temperature=payload.temperature,
            model=payload.model,
            max_tokens=payload.max_tokens,
        )
    except ModelServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return AIGenerationResponse(
        response=generation.content,
        model=generation.model,
        provider="ollama",
        usage=generation.usage,
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

    await _attach_files_to_conversation(
        payload.attachment_ids,
        user_id=user_id,
        conversation_id=conversation_id,
        workspace_id=workspace_id,
    )

    prompt_message, sources, retrieval_debug = await _retrieve_prompt_context(
        message_text,
        user_id,
        conversation_id,
        workspace_id,
    )
    _log_ollama_prompt_debug(
        conversation_id=conversation_id,
        prompt=prompt_message,
        retrieval_debug=retrieval_debug,
    )

    try:
        assistant_response = await call_llm(
            prompt_message,
            context=_build_context(recent_messages),
            temperature=payload.temperature,
            model=payload.model,
            max_tokens=payload.max_tokens,
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

    await _attach_files_to_conversation(
        payload.attachment_ids,
        user_id=user_id,
        conversation_id=conversation_id,
        workspace_id=workspace_id,
    )

    prompt_message, sources, retrieval_debug = await _retrieve_prompt_context(
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
            _log_ollama_prompt_debug(
                conversation_id=conversation_id,
                prompt=prompt_message,
                retrieval_debug=retrieval_debug,
            )
            async for token in call_llm_stream(
                prompt_message,
                context=_build_context(recent_messages),
                temperature=payload.temperature,
                model=payload.model,
                max_tokens=payload.max_tokens,
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
