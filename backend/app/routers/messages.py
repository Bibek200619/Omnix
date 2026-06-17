from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from starlette.responses import StreamingResponse

from ..bootstrap.redis import get_redis
from ..core.security import get_current_user
from ..schemas.chat import (
    AIGenerationRequest,
    AIGenerationResponse,
    ChatRequest,
    ChatResponse,
    MessageFeedbackCreate,
    MessageFeedbackRead,
    MessageRead,
)
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
    upsert_one,
)
from ..services.web_search import WebSearchResponse, get_web_search_service
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
MAX_CONTEXT_CHARS = 8000
DEFAULT_MESSAGE_LIMIT = 50
MAX_MESSAGE_LIMIT = 100
MESSAGE_COLUMNS = "id,conversation_id,user_id,role,content,status,created_at,metadata,payload"
MESSAGE_CONTEXT_COLUMNS = "role,content,status,created_at"
FILE_COLUMNS = (
    "id,user_id,workspace_id,conversation_id,file_name,file_type,metadata,"
    "page_count,extractor_used,extracted_character_count,image_page_count,text_page_count,"
    "extraction_status,extraction_failure_reason,ocr_used,ocr_character_count,created_at"
)

DEFAULT_RATE_LIMIT_RPM = 30
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_KEY_PREFIX = "omnix:ratelimit"
DOCUMENT_INTENT_RE = re.compile(
    r"\b(file|document|doc|pdf|docx|upload|attached|attachment|summari[sz]e|analy[sz]e|resume|contract|report|context|source)\b",
    re.IGNORECASE,
)


def _rate_limit_rpm() -> int:
    raw = os.environ.get("OMNIX_RATE_LIMIT_RPM", str(DEFAULT_RATE_LIMIT_RPM))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        logger.warning("Invalid OMNIX_RATE_LIMIT_RPM=%r; using default %d.", raw, DEFAULT_RATE_LIMIT_RPM)
        return DEFAULT_RATE_LIMIT_RPM
    return max(value, 1)


def _current_minute_bucket() -> int:
    return int(time.time() // RATE_LIMIT_WINDOW_SECONDS)


async def _check_rate_limit(user_id: str) -> None:
    key = f"{RATE_LIMIT_KEY_PREFIX}:{user_id}:{_current_minute_bucket()}"
    try:
        redis = get_redis()
        count = int(await redis.incr(key))
        if count == 1:
            await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS)
    except Exception as exc:
        logger.exception("Redis rate limit check failed | user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Rate limiting is temporarily unavailable.",
        ) from exc

    if count > _rate_limit_rpm():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please try again later.",
        )


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


def _document_unavailable_answer(files: list[dict[str, Any]]) -> str:
    first = files[0] if files else {}
    name = str(first.get("file_name") or "this file")
    status_value = str(first.get("extraction_status") or "processing")
    reason = str(first.get("extraction_failure_reason") or "").strip()

    if status_value == "processing":
        return f"I cannot summarize {name} yet because text extraction has not completed."
    if status_value == "ocr_required":
        return reason or f"I cannot summarize {name} yet because it needs OCR before text can be searched."
    if status_value == "extraction_failed":
        return reason or f"I cannot summarize {name} because text extraction failed."
    return f"I cannot summarize {name} yet because it is not searchable."


def _compact_text(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    if not text:
        return None
    return text[:limit]


def _clean_feedback_reason(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(str(value).split())
    if not normalized:
        return None
    return normalized[:1000]


def _compact_sources_for_payload(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    safe_sources: list[dict[str, Any]] = []
    for source in sources[:12]:
        if not isinstance(source, dict):
            continue

        snippet = _compact_text(
            source.get("snippet") or source.get("excerpt") or source.get("chunk_preview"),
            700,
        )
        compact: dict[str, Any] = {}
        for key, limit in {
            "id": 500,
            "label": 24,
            "type": 40,
            "title": 240,
            "url": 700,
            "domain": 160,
            "favicon_url": 700,
            "published_date": 80,
            "file_id": 120,
        }.items():
            text = _compact_text(source.get(key), limit)
            if text is not None:
                compact[key] = text

        if snippet is not None:
            compact["snippet"] = snippet
            compact["excerpt"] = snippet

        for key in ("score", "chunk_index", "semantic_score", "keyword_score"):
            value = source.get(key)
            if isinstance(value, (int, float)):
                compact[key] = value

        retrieval_sources = source.get("retrieval_sources")
        if isinstance(retrieval_sources, list):
            compact["retrieval_sources"] = [
                str(item)[:40]
                for item in retrieval_sources[:5]
                if isinstance(item, (str, int, float))
            ]

        if compact:
            safe_sources.append(compact)
    return safe_sources


def _sources_from_container(container: Any) -> list[dict[str, Any]]:
    if not isinstance(container, dict):
        return []
    sources = container.get("sources")
    if not isinstance(sources, list):
        return []
    return [source for source in sources if isinstance(source, dict)]


def _message_sources(message: dict[str, Any]) -> list[dict[str, Any]]:
    payload_sources = _sources_from_container(message.get("payload"))
    if payload_sources:
        return payload_sources
    return _sources_from_container(message.get("metadata"))


def _with_sources_payload(message: dict[str, Any]) -> dict[str, Any]:
    sources = _message_sources(message)
    if not sources:
        return message
    return {**message, "sources": sources}


def _mode_from_retrieval_debug(
    requested_mode: SearchMode,
    retrieval_debug: dict[str, Any] | None,
    sources: list[dict[str, Any]],
) -> SearchMode:
    diagnostics = retrieval_debug.get("diagnostics") if isinstance(retrieval_debug, dict) else {}
    web_search = diagnostics.get("web_search") if isinstance(diagnostics, dict) else {}
    decision = web_search.get("decision") if isinstance(web_search, dict) else {}
    effective_mode = decision.get("effective_mode") if isinstance(decision, dict) else None
    if effective_mode in ("auto", "workspace", "web", "hybrid"):
        return effective_mode
    if requested_mode in ("workspace", "web", "hybrid"):
        return requested_mode
    if any(source.get("type") == "web" or source.get("url") for source in sources):
        return "hybrid"
    return "workspace"


def _assistant_message_payload(
    *,
    sources: list[dict[str, Any]],
    search_mode: SearchMode,
    retrieval_debug: dict[str, Any] | None,
) -> dict[str, Any]:
    compact_sources = _compact_sources_for_payload(sources)
    mode = _mode_from_retrieval_debug(search_mode, retrieval_debug, compact_sources)
    web_search_used = any(source.get("type") == "web" or source.get("url") for source in compact_sources)
    citations = [
        str(source["label"])
        for source in compact_sources
        if isinstance(source.get("label"), str) and source.get("label")
    ]
    return {
        "mode": mode,
        "web_search_used": web_search_used,
        "sources": compact_sources,
        "citations": citations,
    }


def _has_persistable_payload(payload: dict[str, Any]) -> bool:
    sources = payload.get("sources")
    return bool(payload.get("web_search_used") or (isinstance(sources, list) and sources))


async def _persist_assistant_payload(
    *,
    assistant_message_id: str,
    user_id: str,
    sources: list[dict[str, Any]],
    search_mode: SearchMode,
    retrieval_debug: dict[str, Any] | None,
    stage: str,
) -> dict[str, Any] | None:
    message_payload = _assistant_message_payload(
        sources=sources,
        search_mode=search_mode,
        retrieval_debug=retrieval_debug,
    )
    if not _has_persistable_payload(message_payload):
        return None

    logger.info(
        "Persisting assistant payload: stage=%s assistant_message_id=%s mode=%s web_search_used=%s source_count=%d",
        stage,
        assistant_message_id,
        message_payload.get("mode"),
        message_payload.get("web_search_used"),
        len(message_payload.get("sources") or []),
    )

    try:
        updated = await update_one_trusted(
            "messages",
            {"id": assistant_message_id, "user_id": user_id},
            {"payload": message_payload},
        )
    except SupabaseServiceError:
        logger.exception(
            "Failed to persist assistant payload: stage=%s assistant_message_id=%s",
            stage,
            assistant_message_id,
        )
        raise

    persisted_payload = updated.get("payload") if isinstance(updated, dict) else None
    if not _has_persistable_payload(persisted_payload if isinstance(persisted_payload, dict) else {}):
        logger.warning(
            "Assistant payload update returned without persisted metadata: stage=%s assistant_message_id=%s",
            stage,
            assistant_message_id,
        )
    return updated


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
    payload: dict[str, Any] = {"content": content, "status": status_value}
    if sources is not None:
        message_payload = _assistant_message_payload(
            sources=sources,
            search_mode=search_mode,
            retrieval_debug=retrieval_debug,
        )
        if _has_persistable_payload(message_payload):
            payload["payload"] = message_payload

    try:
        return await update_one(
            "messages",
            {"id": assistant_message_id, "user_id": user_id},
            payload,
        )
    except SupabaseServiceError:
        if "payload" not in payload:
            raise
        logger.warning("Message payload column unavailable; trying legacy metadata before finalizing without sources.")
        try:
            return await update_one(
                "messages",
                {"id": assistant_message_id, "user_id": user_id},
                {
                    "content": content,
                    "status": status_value,
                    "metadata": {"sources": payload["payload"]["sources"]},
                },
            )
        except SupabaseServiceError:
            logger.warning("Message metadata column unavailable; finalizing assistant message without persisted sources.")
            return await update_one(
                "messages",
                {"id": assistant_message_id, "user_id": user_id},
                {"content": content, "status": status_value},
            )


def _should_skip_retrieval_for_prompt(message_text: str) -> bool:
    normalized = " ".join((message_text or "").strip().split())
    if not normalized:
        return True

    if DOCUMENT_INTENT_RE.search(normalized):
        return False

    return len(normalized) <= 120


def _log_ollama_prompt_debug(
    *,
    conversation_id: str,
    prompt: str,
    retrieval_debug: dict[str, Any],
) -> None:
    diagnostics = retrieval_debug.get("diagnostics") if isinstance(retrieval_debug.get("diagnostics"), dict) else {}
    web_search = diagnostics.get("web_search") if isinstance(diagnostics.get("web_search"), dict) else {}
    context_diag = diagnostics if isinstance(diagnostics, dict) else {}
    logger.info(
        "Ollama prompt debug: conversation_id=%s retrieval_strategy=%s retrieved_chunks_count=%d "
        "prompt_length=%d has_web_results=%s has_document_context=%s web_search=%s context_counts=%s "
        "has_first_retrieved_chunk=%s",
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
        bool(retrieval_debug.get("first_chunk_preview")),
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


async def _build_web_supplements(
    message_text: str,
    *,
    workspace_id: str | None,
    search_mode: SearchMode,
) -> tuple[list[Any], list[dict[str, Any]], SearchDecision, dict[str, Any]]:
    decision = classify_search_need(message_text, search_mode)
    diagnostics: dict[str, Any] = {"decision": decision.to_dict(), "search": None}
    logger.info(
        "Web search decision: mode=%s effective_mode=%s needs_web=%s confidence=%.2f reasons=%s query=%r",
        decision.requested_mode,
        decision.effective_mode,
        decision.needs_web,
        decision.confidence,
        decision.reasons,
        message_text[:240],
    )
    if not decision.needs_web:
        return [], [], decision, diagnostics

    service = get_web_search_service()
    try:
        search_response: WebSearchResponse = await service.search(message_text)
    except Exception as exc:
        logger.exception("Web search failed before generation: %s", exc)
        diagnostics["search"] = {"ok": False, "error": "unexpected_search_error"}
        return [], [], decision, diagnostics

    diagnostics["search"] = search_response.to_diagnostics()
    if not search_response.results:
        logger.warning(
            "Web search returned no usable results: query=%r diagnostics=%s",
            message_text[:160],
            diagnostics["search"],
        )
        return [], [], decision, diagnostics

    supplements = [
        result.to_supplement(workspace_id=workspace_id)
        for result in search_response.results
    ]
    sources = [
        result.to_source(label=f"W{index}")
        for index, result in enumerate(search_response.results, start=1)
    ]
    logger.info(
        "Web context formatted: query=%r result_count=%d first_result=%s",
        message_text[:160],
        len(supplements),
        {
            "title": search_response.results[0].title,
            "url": search_response.results[0].url,
            "snippet_preview": search_response.results[0].snippet[:240],
        },
    )
    return supplements, sources, decision, diagnostics


def _merge_sources(*source_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in source_groups:
        for source in group:
            if not isinstance(source, dict):
                continue
            key = str(source.get("url") or source.get("id") or source.get("label") or "")
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            merged.append(source)
    return merged


def _web_only_context(
    message_text: str,
    *,
    workspace_id: str | None,
    web_supplements: list[Any],
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    from ..retrieval.context_builder import ContextBuilder

    builder = ContextBuilder(
        max_chunks=max(1, len(web_supplements)),
        token_budget=2200,
        max_chunk_tokens=360,
    )
    built_context = builder.build(
        message_text,
        [],
        workspace_id=workspace_id,
        supplemental_contexts=web_supplements,
    )
    return (
        built_context.prompt,
        built_context.sources,
        _retrieval_debug_from_context("web", built_context),
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
    prompt_message = message_text
    scope_workspace_ids = (
        [
            str(item)
            for item in (intelligence_profile or {}).get("scope_workspace_ids", [])
            if str(item or "").strip()
        ]
        or None
    )
    has_new_attachments = any(str(item).strip() for item in attachment_ids or [])
    web_supplements, web_sources, search_decision, web_diagnostics = await _build_web_supplements(
        message_text,
        workspace_id=workspace_id,
        search_mode=search_mode,
    )
    if search_mode == "web":
        if web_supplements:
            prompt, sources, debug = _web_only_context(
                message_text,
                workspace_id=workspace_id,
                web_supplements=web_supplements,
            )
            debug["diagnostics"]["web_search"] = web_diagnostics
            return prompt, _merge_sources(sources, web_sources), debug
        debug = _empty_retrieval_debug("web_unavailable")
        debug["diagnostics"]["web_search"] = web_diagnostics
        if intelligence_profile:
            debug["workspace_intelligence"] = _compact_intelligence_debug(intelligence_profile)
        return prompt_message, [], debug

    if (
        not has_new_attachments
        and not search_decision.needs_web
        and _should_skip_retrieval_for_prompt(message_text)
    ):
        logger.info(
            "Skipping retrieval for lightweight prompt: conversation_id=%s workspace_id=%s.",
            conversation_id,
            workspace_id,
        )
        debug = _empty_retrieval_debug("lightweight_prompt")
        debug["diagnostics"]["web_search"] = web_diagnostics
        if intelligence_profile:
            debug["workspace_intelligence"] = _compact_intelligence_debug(intelligence_profile)
        return prompt_message, [], debug

    try:
        uploaded_context = await build_uploaded_document_context(
            message_text,
            user_id=user_id,
            conversation_id=conversation_id,
            workspace_id=workspace_id,
            scope_workspace_ids=scope_workspace_ids,
            supplemental_contexts=web_supplements,
        )
        if uploaded_context and uploaded_context.sources:
            uploaded_context.diagnostics["web_search"] = web_diagnostics
            uploaded_context.diagnostics["workspace_intelligence"] = _compact_intelligence_debug(intelligence_profile)
            return (
                uploaded_context.prompt,
                _merge_sources(uploaded_context.sources, web_sources),
                _retrieval_debug_from_context("uploaded_document", uploaded_context),
            )
    except Exception as exc:
        logger.exception("Uploaded document context retrieval failed for conversation %s: %s", conversation_id, exc)

    if DOCUMENT_INTENT_RE.search(message_text):
        unavailable_files = await find_unavailable_uploaded_documents(
            user_id=user_id,
            conversation_id=conversation_id,
            workspace_id=workspace_id,
            scope_workspace_ids=scope_workspace_ids,
        )
        if unavailable_files:
            debug = _empty_retrieval_debug("document_unavailable")
            debug["diagnostics"]["web_search"] = web_diagnostics
            debug["diagnostics"]["unavailable_documents"] = unavailable_files
            if intelligence_profile:
                debug["workspace_intelligence"] = _compact_intelligence_debug(intelligence_profile)
            return _document_unavailable_answer(unavailable_files), [], debug

    if not await _has_retrievable_documents(
        user_id=user_id,
        workspace_id=workspace_id,
        scope_workspace_ids=scope_workspace_ids,
    ):
        logger.info(
            "Skipping hybrid retrieval because no document chunks exist for conversation %s workspace_id=%s.",
            conversation_id,
            workspace_id,
        )
        if web_supplements:
            prompt, sources, debug = _web_only_context(
                message_text,
                workspace_id=workspace_id,
                web_supplements=web_supplements,
            )
            debug["diagnostics"]["web_search"] = web_diagnostics
            return prompt, _merge_sources(sources, web_sources), debug
        debug = _empty_retrieval_debug("no_documents")
        debug["diagnostics"]["web_search"] = web_diagnostics
        if intelligence_profile:
            debug["workspace_intelligence"] = _compact_intelligence_debug(intelligence_profile)
        return prompt_message, [], debug

    try:
        from ..rag.startup import get_vector_store
        from ..retrieval.context_builder import ContextBuilder
        from ..retrieval.hybrid_search import HybridSearchEngine

        engine = HybridSearchEngine(get_vector_store())
        response = await engine.search(
            message_text,
            user_id=user_id,
            workspace_id=workspace_id,
        )
        if web_supplements:
            context_builder = ContextBuilder(
                max_chunks=min(engine.context_builder.max_chunks + len(web_supplements), 10),
                token_budget=min(engine.context_builder.token_budget + (len(web_supplements) * 360), 4200),
                max_chunk_tokens=engine.context_builder.max_chunk_tokens,
            )
            logger.info(
                "Hybrid context builder expanded for web: base_max_chunks=%d web_supplements=%d final_max_chunks=%d token_budget=%d",
                engine.context_builder.max_chunks,
                len(web_supplements),
                context_builder.max_chunks,
                context_builder.token_budget,
            )
        else:
            context_builder = engine.context_builder

        built_context = context_builder.build(
            message_text,
            response.results,
            workspace_id=workspace_id,
            supplemental_contexts=web_supplements,
        )
        response.diagnostics["context"] = built_context.diagnostics
        built_context.diagnostics["web_search"] = web_diagnostics
        built_context.diagnostics["workspace_intelligence"] = _compact_intelligence_debug(intelligence_profile)

        if built_context.sources:
            return (
                built_context.prompt,
                _merge_sources(built_context.sources, web_sources),
                _retrieval_debug_from_context("hybrid", built_context),
            )
    except Exception as exc:
        logger.exception("Hybrid retrieval failed for conversation %s: %s", conversation_id, exc)

    if web_supplements:
        prompt, sources, debug = _web_only_context(
            message_text,
            workspace_id=workspace_id,
            web_supplements=web_supplements,
        )
        debug["diagnostics"]["web_search"] = web_diagnostics
        return prompt, _merge_sources(sources, web_sources), debug

    debug = _empty_retrieval_debug()
    debug["diagnostics"]["web_search"] = web_diagnostics
    if intelligence_profile:
        debug["workspace_intelligence"] = _compact_intelligence_debug(intelligence_profile)
    return prompt_message, [], debug


def _compact_intelligence_debug(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    if not profile:
        return None
    return {
        "workspace_id": profile.get("workspace_id"),
        "workspace_name": profile.get("workspace_name"),
        "workspace_focus": profile.get("workspace_focus") or profile.get("ai_specialization"),
        "ai_specialization": profile.get("ai_specialization"),
        "retrieval_scope": profile.get("retrieval_scope"),
        "source_count": profile.get("source_count"),
        "active_domains": profile.get("active_domains", [])[:8],
        "scope_workspace_ids": profile.get("scope_workspace_ids", [])[:20],
    }


async def _load_workspace_intelligence_for_chat(
    workspace_id: str | None,
    user_id: str,
) -> dict[str, Any] | None:
    if not workspace_id:
        return None
    try:
        return await build_workspace_intelligence_profile(workspace_id, user_id)
    except Exception:
        logger.exception("Failed to load workspace intelligence profile for chat; continuing with generic AI context.")
        return None


async def _has_retrievable_documents(
    *,
    user_id: str,
    workspace_id: str | None,
    scope_workspace_ids: list[str] | None = None,
) -> bool:
    try:
        workspace_ids = [
            str(item)
            for item in (scope_workspace_ids or ([workspace_id] if workspace_id else []))
            if str(item or "").strip()
        ]
        if workspace_ids:
            rows = await select_all_trusted(
                "documents",
                "id,workspace_id",
                filters={"workspace_id": workspace_ids},
                limit=1,
            )
            scope_set = set(workspace_ids)
            return any(str(row.get("workspace_id") or "") in scope_set for row in rows)

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

    messages = await _load_message_list(
        conversation_id,
        user_id,
        str(conversation.get("workspace_id") or "") if workspace_access is not None else None,
        limit,
        offset,
    )
    return [_with_sources_payload(message) for message in messages]


@router.post(
    "/conversations/{conversation_id}/messages/{message_id}/feedback",
    response_model=MessageFeedbackRead,
    status_code=status.HTTP_201_CREATED,
)
async def submit_message_feedback(
    conversation_id: str,
    message_id: str,
    payload: MessageFeedbackCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    conversation, workspace_access = await require_conversation_access(conversation_id, user_id)
    workspace_id = str(conversation.get("workspace_id") or "") if workspace_access is not None else None

    try:
        message = await select_one_trusted(
            "messages",
            MESSAGE_COLUMNS,
            {"id": message_id, "conversation_id": conversation_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    if message.get("role") != "assistant":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Feedback can only be submitted for assistant messages.",
        )
    if workspace_id is None and str(message.get("user_id") or "") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

    feedback_payload = {
        "conversation_id": conversation_id,
        "message_id": message_id,
        "user_id": user_id,
        "workspace_id": workspace_id,
        "rating": payload.rating,
        "reason": _clean_feedback_reason(payload.reason),
        "updated_at": utc_now_iso(),
    }

    try:
        feedback = await upsert_one(
            "message_feedback",
            feedback_payload,
            on_conflict="message_id,user_id",
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if workspace_id:
        await log_workspace_activity(
            workspace_id=workspace_id,
            actor_user_id=user_id,
            event_type="workspace.ai_feedback_submitted",
            summary="AI response feedback was submitted.",
            metadata={
                "conversation_id": conversation_id,
                "message_id": message_id,
                "rating": payload.rating,
                "has_reason": feedback_payload["reason"] is not None,
            },
        )

    return feedback


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
    await _check_rate_limit(user_id)

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
        logger.exception("Failed to generate AI response")
        raise HTTPException(status_code=exc.status_code, detail="AI generation is unavailable.") from exc

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
    await _check_rate_limit(user_id)
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
    await _check_rate_limit(user_id)

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
