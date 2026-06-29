from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from starlette.responses import StreamingResponse

from ..core.config import get_settings
from ..core.security import get_current_user
from ..observability.safe_logging import allow_sensitive_logging, safe_text_preview
from ..rag.token_utils import count_tokens, tail_tokens
from ..schemas.chat import AIGenerationRequest, AIGenerationResponse, ChatRequest, ChatResponse, MessageRead
from ..services import message_payload_service, message_retrieval_service
from ..services.chat_service import (
    AIMessage,
    ModelServiceError,
    call_llm,
    call_llm_stream,
    generate_ai_response,
)
from ..services.document_context_service import build_uploaded_document_context, find_unavailable_uploaded_documents
from ..services.query_classifier import SearchDecision, SearchMode, classify_search_need
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
from ..services.web_search import get_web_search_service
from ..services.workspace_intelligence_service import (
    build_workspace_intelligence_profile,
    workspace_intelligence_system_prompt,
)
from ..services.workspace_service import require_active_workspace_access, utc_now_iso
from ..services.workspace_collaboration_service import log_workspace_activity
from .conversations import (
    build_conversation_title,
    hydrate_conversation_history,
    require_conversation_access,
)

router = APIRouter(tags=["messages"])
logger = logging.getLogger(__name__)

RECENT_CONTEXT_LIMIT = 4
DEFAULT_MESSAGE_LIMIT = 50
MAX_MESSAGE_LIMIT = 100
MESSAGE_COLUMNS = "id,conversation_id,user_id,role,content,status,created_at,metadata,payload"
MESSAGE_CONTEXT_COLUMNS = "role,content,status,created_at"
FILE_COLUMNS = (
    "id,user_id,workspace_id,conversation_id,file_name,file_type,metadata,"
    "page_count,extractor_used,extracted_character_count,image_page_count,text_page_count,"
    "extraction_status,extraction_failure_reason,ocr_used,ocr_character_count,created_at"
)

RATE_LIMIT_REQUESTS = 5
RATE_LIMIT_WINDOW = 60.0
_chat_rate_limits: dict[str, list[float]] = {}
DOCUMENT_INTENT_RE = message_retrieval_service.DOCUMENT_INTENT_RE
PUBLIC_AI_SYSTEM_PROMPT_ERROR = "Public AI generation does not accept caller-supplied system prompts."


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


def _public_allowed_models() -> set[str]:
    settings = get_settings()
    configured = [
        item.strip()
        for item in str(getattr(settings, "AI_PUBLIC_ALLOWED_MODELS", "") or "").split(",")
        if item.strip()
    ]
    if configured:
        return set(configured)
    return {
        item
        for item in (
            getattr(settings, "ollama_model", None),
            getattr(settings, "OPENAI_CHAT_MODEL", None),
            getattr(settings, "ANTHROPIC_CHAT_MODEL", None),
        )
        if isinstance(item, str) and item.strip()
    }


def _public_ai_generation_policy(payload: AIGenerationRequest) -> dict[str, Any]:
    if payload.system_prompt and payload.system_prompt.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=PUBLIC_AI_SYSTEM_PROMPT_ERROR)
    if any(message.role == "system" for message in payload.context):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=PUBLIC_AI_SYSTEM_PROMPT_ERROR)

    allowed_models = _public_allowed_models()
    requested_model = payload.model.strip() if payload.model else None
    if requested_model and requested_model not in allowed_models:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Requested model is not allowed for public generation.")

    settings = get_settings()
    max_public_tokens = max(1, min(int(getattr(settings, "AI_PUBLIC_MAX_OUTPUT_TOKENS", 512)), 4096))
    max_public_temperature = max(0.0, min(float(getattr(settings, "AI_PUBLIC_MAX_TEMPERATURE", 0.8)), 2.0))

    return {
        "context": [AIMessage(role=message.role, content=message.content) for message in payload.context],
        "temperature": min(float(payload.temperature), max_public_temperature),
        "model": requested_model,
        "max_tokens": min(int(payload.max_tokens or max_public_tokens), max_public_tokens),
    }


def _build_context(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    settings = get_settings()
    max_context_messages = max(1, min(int(settings.AI_MAX_CONTEXT_MESSAGES), RECENT_CONTEXT_LIMIT))
    remaining_tokens = max(128, min(int(settings.AI_MAX_CONTEXT_TOKENS), 16_000))
    bounded_context: list[dict[str, str]] = []

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

        message_tokens = count_tokens(normalized_content, model=settings.ollama_model) + 4
        if message_tokens > remaining_tokens:
            if not bounded_context and remaining_tokens > 8:
                trimmed_content = tail_tokens(normalized_content, remaining_tokens - 4)
                if trimmed_content:
                    bounded_context.append({"role": role, "content": trimmed_content})
            break

        bounded_context.append({"role": role, "content": normalized_content})
        remaining_tokens -= message_tokens

        if len(bounded_context) >= max_context_messages or remaining_tokens <= 8:
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


_retrieval_debug_from_context = message_retrieval_service.retrieval_debug_from_context
_empty_retrieval_debug = message_retrieval_service.empty_retrieval_debug
_document_unavailable_answer = message_retrieval_service.document_unavailable_answer
_should_skip_retrieval_for_prompt = message_retrieval_service.should_skip_retrieval_for_prompt
_merge_sources = message_retrieval_service.merge_sources
_web_only_context = message_retrieval_service.web_only_context
_compact_intelligence_debug = message_retrieval_service.compact_intelligence_debug

_compact_text = message_payload_service.compact_text
_compact_sources_for_payload = message_payload_service.compact_sources_for_payload
_sources_from_container = message_payload_service.sources_from_container
_message_sources = message_payload_service.message_sources
_with_sources_payload = message_payload_service.with_sources_payload
_mode_from_retrieval_debug = message_payload_service.mode_from_retrieval_debug
_assistant_message_payload = message_payload_service.assistant_message_payload
_has_persistable_payload = message_payload_service.has_persistable_payload


async def _persist_assistant_payload(
    *,
    assistant_message_id: str,
    user_id: str,
    sources: list[dict[str, Any]],
    search_mode: SearchMode,
    retrieval_debug: dict[str, Any] | None,
    stage: str,
) -> dict[str, Any] | None:
    return await message_payload_service.persist_assistant_payload(
        assistant_message_id=assistant_message_id,
        user_id=user_id,
        sources=sources,
        search_mode=search_mode,
        retrieval_debug=retrieval_debug,
        stage=stage,
        update_one_trusted_fn=update_one_trusted,
    )


async def _update_assistant_message(
    *,
    assistant_message_id: str,
    user_id: str,
    content: str,
    status_value: str,
    sources: list[dict[str, Any]] | None = None,
    search_mode: SearchMode = "auto",
    retrieval_debug: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    return await message_payload_service.update_assistant_message(
        assistant_message_id=assistant_message_id,
        user_id=user_id,
        content=content,
        status_value=status_value,
        sources=sources,
        search_mode=search_mode,
        retrieval_debug=retrieval_debug,
        update_one_fn=update_one,
)


async def _build_web_supplements(
    message_text: str,
    *,
    workspace_id: str | None,
    search_mode: SearchMode,
) -> tuple[list[Any], list[dict[str, Any]], SearchDecision, dict[str, Any]]:
    return await message_retrieval_service.build_web_supplements(
        message_text,
        workspace_id=workspace_id,
        search_mode=search_mode,
        get_web_search_service_fn=get_web_search_service,
        classify_search_need_fn=classify_search_need,
    )


async def _retrieve_prompt_context(
    message_text: str,
    user_id: str,
    conversation_id: str,
    workspace_id: str | None,
    attachment_ids: list[str] | None = None,
    search_mode: SearchMode = "auto",
    intelligence_profile: dict[str, Any] | None = None,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    return await message_retrieval_service.retrieve_prompt_context(
        message_text,
        user_id,
        conversation_id,
        workspace_id,
        attachment_ids,
        search_mode,
        intelligence_profile,
        build_web_supplements_fn=_build_web_supplements,
        build_uploaded_document_context_fn=build_uploaded_document_context,
        find_unavailable_uploaded_documents_fn=find_unavailable_uploaded_documents,
        has_retrievable_documents_fn=_has_retrievable_documents,
        document_unavailable_answer_fn=_document_unavailable_answer,
    )


async def _load_workspace_intelligence_for_chat(
    workspace_id: str | None,
    user_id: str,
) -> dict[str, Any] | None:
    return await message_retrieval_service.load_workspace_intelligence_for_chat(
        workspace_id,
        user_id,
        build_workspace_intelligence_profile_fn=build_workspace_intelligence_profile,
    )


async def _has_retrievable_documents(
    *,
    user_id: str,
    workspace_id: str | None,
    scope_workspace_ids: list[str] | None = None,
) -> bool:
    return await message_retrieval_service.has_retrievable_documents(
        user_id=user_id,
        workspace_id=workspace_id,
        scope_workspace_ids=scope_workspace_ids,
        select_all_fn=select_all,
        select_all_trusted_fn=select_all_trusted,
    )


def _log_ollama_prompt_debug(
    *,
    conversation_id: str,
    prompt: str,
    retrieval_debug: dict[str, Any],
) -> None:
    diagnostics = retrieval_debug.get("diagnostics") if isinstance(retrieval_debug.get("diagnostics"), dict) else {}
    web_search = diagnostics.get("web_search") if isinstance(diagnostics.get("web_search"), dict) else {}
    context_diag = diagnostics if isinstance(diagnostics, dict) else {}
    sensitive_logging = allow_sensitive_logging()
    logger.info(
        "Ollama prompt debug: conversation_id=%s retrieval_strategy=%s retrieved_chunks_count=%d "
        "prompt_length=%d has_web_results=%s has_document_context=%s web_search=%s context_counts=%s "
        "sensitive_previews_enabled=%s first_retrieved_chunk_preview=%r prompt_preview=%r",
        conversation_id,
        retrieval_debug.get("strategy", "unknown"),
        int(retrieval_debug.get("retrieved_chunks_count") or 0),
        len(prompt or ""),
        "WEB SEARCH RESULTS:" in (prompt or ""),
        "DOCUMENT CONTEXT:" in (prompt or ""),
        web_search,
        {
            "web_context_count": context_diag.get("web_context_count"),
            "document_context_count": context_diag.get("document_context_count"),
            "estimated_context_tokens": context_diag.get("estimated_context_tokens"),
        },
        sensitive_logging,
        safe_text_preview(retrieval_debug.get("first_chunk_preview") or "", max_chars=240),
        safe_text_preview(prompt, max_chars=1000),
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

    messages = await _load_message_list(
        conversation_id,
        user_id,
        str(conversation.get("workspace_id") or "") if workspace_access is not None else None,
        limit,
        offset,
    )
    return [_with_sources_payload(message) for message in messages]


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
    policy = _public_ai_generation_policy(payload)

    try:
        generation = await generate_ai_response(
            payload.prompt,
            context=policy["context"],
            system_prompt=None,
            temperature=policy["temperature"],
            model=policy["model"],
            max_tokens=policy["max_tokens"],
        )
    except ModelServiceError as exc:
        logger.exception("Failed to generate AI response")
        raise HTTPException(status_code=exc.status_code, detail="AI generation is unavailable.") from exc

    return AIGenerationResponse(
        response=generation.content,
        model=generation.model,
        provider=generation.provider,
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

    intelligence_profile = await _load_workspace_intelligence_for_chat(workspace_id, user_id)
    workspace_system_prompt = workspace_intelligence_system_prompt(intelligence_profile)
    prompt_message, sources, retrieval_debug = await _retrieve_prompt_context(
        message_text,
        user_id,
        conversation_id,
        workspace_id,
        payload.attachment_ids,
        payload.search_mode,
        intelligence_profile,
    )
    try:
        await _persist_assistant_payload(
            assistant_message_id=str(assistant_message["id"]),
            user_id=user_id,
            sources=sources,
            search_mode=payload.search_mode,
            retrieval_debug=retrieval_debug,
            stage="chat_retrieved",
        )
    except SupabaseServiceError:
        logger.warning(
            "Continuing chat generation after assistant payload pre-persist failed: assistant_message_id=%s",
            assistant_message["id"],
        )
    _log_ollama_prompt_debug(
        conversation_id=conversation_id,
        prompt=prompt_message,
        retrieval_debug=retrieval_debug,
    )

    if retrieval_debug.get("strategy") == "document_unavailable":
        assistant_response = prompt_message
    else:
        try:
            assistant_response = await call_llm(
                prompt_message,
                context=_build_context(recent_messages),
                system_prompt=workspace_system_prompt or None,
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
            logger.exception("Failed to generate chat response")
            raise HTTPException(status_code=exc.status_code, detail="AI response is unavailable.") from exc

    timestamp = utc_now_iso()

    try:
        completed_assistant_message, _ = await asyncio.gather(
            _update_assistant_message(
                assistant_message_id=str(assistant_message["id"]),
                user_id=user_id,
                content=assistant_response,
                status_value="completed",
                sources=sources,
                search_mode=payload.search_mode,
                retrieval_debug=retrieval_debug,
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

    if workspace_id:
        await log_workspace_activity(
            workspace_id=workspace_id,
            actor_user_id=user_id,
            event_type="workspace.ai_response_generated",
            summary=f"{(intelligence_profile or {}).get('workspace_name') or 'Workspace'} AI generated a response.",
            metadata={
                "conversation_id": conversation_id,
                "assistant_message_id": str(completed_assistant_message["id"]),
                "source_count": len(sources),
                "search_mode": payload.search_mode,
                "workspace_focus": (intelligence_profile or {}).get("workspace_focus"),
                "ai_specialization": (intelligence_profile or {}).get("ai_specialization"),
            },
        )

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
        assistant_message=_with_sources_payload(completed_assistant_message),
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

    intelligence_profile = await _load_workspace_intelligence_for_chat(workspace_id, user_id)
    workspace_system_prompt = workspace_intelligence_system_prompt(intelligence_profile)

    async def event_generator() -> AsyncIterator[str]:
        assistant_parts: list[str] = []
        client_disconnected = False
        prompt_message = message_text
        sources: list[dict[str, Any]] = []
        retrieval_debug = _empty_retrieval_debug("pending")

        init_payload = {
            "type": "init",
            "conversation_id": conversation_id,
            "user_message_id": str(user_message.get("id")),
            "assistant_message_id": str(assistant_message.get("id")),
            "sources": [],
        }
        yield f"data: {json.dumps(init_payload)}\n\n"

        status_payload = {"type": "status", "status": "researching", "count": 0}
        yield f"data: {json.dumps(status_payload)}\n\n"

        try:
            prompt_message, sources, retrieval_debug = await _retrieve_prompt_context(
                message_text,
                user_id,
                conversation_id,
                workspace_id,
                payload.attachment_ids,
                payload.search_mode,
                intelligence_profile,
            )
            sources_payload = {
                "type": "sources",
                "sources": sources,
                "retrieval": retrieval_debug,
                "workspace_intelligence": _compact_intelligence_debug(intelligence_profile),
            }
            yield f"data: {json.dumps(sources_payload)}\n\n"

            status_payload = {"type": "status", "status": "retrieved", "count": len(sources)}
            yield f"data: {json.dumps(status_payload)}\n\n"

            try:
                await _persist_assistant_payload(
                    assistant_message_id=str(assistant_message["id"]),
                    user_id=user_id,
                    sources=sources,
                    search_mode=payload.search_mode,
                    retrieval_debug=retrieval_debug,
                    stage="stream_retrieved",
                )
            except SupabaseServiceError:
                logger.warning(
                    "Continuing streaming after assistant payload pre-persist failed: assistant_message_id=%s",
                    assistant_message["id"],
                )

            _log_ollama_prompt_debug(
                conversation_id=conversation_id,
                prompt=prompt_message,
                retrieval_debug=retrieval_debug,
            )
            if retrieval_debug.get("strategy") == "document_unavailable":
                assistant_parts.append(prompt_message)
                yield f"data: {json.dumps({'type': 'token', 'text': prompt_message})}\n\n"
            else:
                async for token in call_llm_stream(
                    prompt_message,
                    context=_build_context(recent_messages),
                    system_prompt=workspace_system_prompt or None,
                    temperature=payload.temperature,
                    model=payload.model,
                    max_tokens=payload.max_tokens,
                ):
                    if await request.is_disconnected():
                        logger.info("Client disconnected during streaming.")
                        client_disconnected = True
                        break

                    assistant_parts.append(token)
                    payload_chunk = {"type": "token", "text": token}
                    yield f"data: {json.dumps(payload_chunk)}\n\n"
        except ModelServiceError as exc:
            logger.exception("Failed to stream chat response")
            err = {"type": "error", "detail": "AI response is unavailable."}
            yield f"data: {json.dumps(err)}\n\n"
            try:
                await _update_assistant_message(
                    assistant_message_id=str(assistant_message["id"]),
                    user_id=user_id,
                    content="".join(assistant_parts),
                    status_value="failed",
                    sources=sources,
                    search_mode=payload.search_mode,
                    retrieval_debug=retrieval_debug,
                )
            except Exception:
                logger.exception("Failed to mark streaming assistant message as failed.")
            return
        except Exception as exc:
            logger.exception("Unexpected streaming error: %s", exc)
            err = {"type": "error", "detail": "Streaming failed unexpectedly."}
            yield f"data: {json.dumps(err)}\n\n"
            try:
                await _update_assistant_message(
                    assistant_message_id=str(assistant_message["id"]),
                    user_id=user_id,
                    content="".join(assistant_parts),
                    status_value="failed",
                    sources=sources,
                    search_mode=payload.search_mode,
                    retrieval_debug=retrieval_debug,
                )
            except Exception:
                logger.exception("Failed to mark unexpected streaming error state.")
            return

        final_content = "".join(assistant_parts)
        finished_at = utc_now_iso()

        try:
            await asyncio.gather(
                _update_assistant_message(
                    assistant_message_id=str(assistant_message["id"]),
                    user_id=user_id,
                    content=final_content,
                    status_value="failed" if client_disconnected else "completed",
                    sources=sources,
                    search_mode=payload.search_mode,
                    retrieval_debug=retrieval_debug,
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

        if client_disconnected:
            return

        if workspace_id and final_content:
            await log_workspace_activity(
                workspace_id=workspace_id,
                actor_user_id=user_id,
                event_type="workspace.ai_response_generated",
                summary=f"{(intelligence_profile or {}).get('workspace_name') or 'Workspace'} AI generated a response.",
                metadata={
                    "conversation_id": conversation_id,
                    "assistant_message_id": str(assistant_message["id"]),
                    "source_count": len(sources),
                    "search_mode": payload.search_mode,
                    "workspace_focus": (intelligence_profile or {}).get("workspace_focus"),
                    "ai_specialization": (intelligence_profile or {}).get("ai_specialization"),
                },
            )

        done_payload = {"type": "done", "conversation_id": conversation_id}
        yield f"data: {json.dumps(done_payload)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
