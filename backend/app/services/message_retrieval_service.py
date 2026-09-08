from __future__ import annotations

from collections.abc import Awaitable, Callable
import logging
import re
from typing import Any

from ..observability.safe_logging import safe_text_preview
from .document_context_service import build_uploaded_document_context, find_unavailable_uploaded_documents
from .prompt_trust import untrusted_user_request_block
from .query_classifier import SearchDecision, SearchMode, classify_search_need
from .retrieval_state import (
    WEB_NO_RESULTS_ANSWER,
    apply_channel_failure,
    hybrid_retrieval_state,
    prompt_with_retrieval_coverage_guard,
    retrieval_unavailable_answer,
    set_retrieval_outcome,
    should_bypass_model_for_retrieval,
)
from .message_retrieval_support import (
    compact_intelligence_debug,
    has_retrievable_documents,
    is_lightweight_conversation,
    load_workspace_intelligence_for_chat,
    merge_sources,
)
from .web_search import WebSearchResponse, get_web_search_service

logger = logging.getLogger(__name__)
DOCUMENT_INTENT_RE = re.compile(
    r"\b(file|document|doc|pdf|docx|upload|attached|attachment|summari[sz]e|analy[sz]e|resume|contract|report|context|source)\b",
    re.IGNORECASE,
)

BuildWebSupplementsFn = Callable[..., Awaitable[tuple[list[Any], list[dict[str, Any]], SearchDecision, dict[str, Any]]]]
UploadedContextFn = Callable[..., Awaitable[Any]]
UnavailableDocumentsFn = Callable[..., Awaitable[list[dict[str, Any]]]]
HasRetrievableDocumentsFn = Callable[..., Awaitable[bool]]
def retrieval_debug_from_context(
    strategy: str,
    built_context: Any,
    *,
    outcome: str = "sources_found",
    reason: str | None = None,
    failed_channels: list[str] | None = None,
) -> dict[str, Any]:
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

    debug = {
        "strategy": strategy,
        "retrieved_chunks_count": len(chunks) or len(sources),
        "first_chunk_preview": safe_text_preview(preview, max_chars=240),
        "diagnostics": getattr(built_context, "diagnostics", {}),
    }
    return set_retrieval_outcome(
        debug,
        outcome=outcome,
        reason=reason,
        failed_channels=failed_channels,
    )


def empty_retrieval_debug(
    strategy: str = "none",
    *,
    outcome: str = "not_requested",
    reason: str | None = None,
    failed_channels: list[str] | None = None,
) -> dict[str, Any]:
    return set_retrieval_outcome({
        "strategy": strategy,
        "retrieved_chunks_count": 0,
        "first_chunk_preview": "",
        "diagnostics": {},
    }, outcome=outcome, reason=reason, failed_channels=failed_channels)
def document_unavailable_answer(files: list[dict[str, Any]]) -> str:
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


def should_skip_retrieval_for_prompt(message_text: str) -> bool:
    normalized = " ".join((message_text or "").strip().split())
    if not normalized:
        return True

    if DOCUMENT_INTENT_RE.search(normalized):
        return False

    return len(normalized) <= 120


async def build_web_supplements(
    message_text: str,
    *,
    workspace_id: str | None,
    search_mode: SearchMode,
    get_web_search_service_fn: Callable[[], Any] = get_web_search_service,
    classify_search_need_fn: Callable[[str, SearchMode], SearchDecision] = classify_search_need,
) -> tuple[list[Any], list[dict[str, Any]], SearchDecision, dict[str, Any]]:
    decision = classify_search_need_fn(message_text, search_mode)
    diagnostics: dict[str, Any] = {"decision": decision.to_dict(), "search": None}
    logger.info(
        "Web search decision: mode=%s effective_mode=%s needs_web=%s confidence=%.2f reasons=%s query=%r",
        decision.requested_mode,
        decision.effective_mode,
        decision.needs_web,
        decision.confidence,
        decision.reasons,
        safe_text_preview(message_text, max_chars=240),
    )
    if not decision.needs_web:
        return [], [], decision, diagnostics

    service = get_web_search_service_fn()
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
            safe_text_preview(message_text, max_chars=160),
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
        safe_text_preview(message_text, max_chars=160),
        len(supplements),
        {
            "title": search_response.results[0].title,
            "url": search_response.results[0].url,
            "snippet_preview": safe_text_preview(search_response.results[0].snippet, max_chars=240),
        },
    )
    return supplements, sources, decision, diagnostics


def web_only_context(
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
        retrieval_debug_from_context("web", built_context),
    )


async def retrieve_prompt_context(
    message_text: str,
    user_id: str,
    conversation_id: str,
    workspace_id: str | None,
    attachment_ids: list[str] | None = None,
    search_mode: SearchMode = "auto",
    intelligence_profile: dict[str, Any] | None = None,
    *,
    build_web_supplements_fn: BuildWebSupplementsFn = build_web_supplements,
    build_uploaded_document_context_fn: UploadedContextFn = build_uploaded_document_context,
    find_unavailable_uploaded_documents_fn: UnavailableDocumentsFn = find_unavailable_uploaded_documents,
    has_retrievable_documents_fn: HasRetrievableDocumentsFn | None = None,
    document_unavailable_answer_fn: Callable[[list[dict[str, Any]]], str] = document_unavailable_answer,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    prompt_message = untrusted_user_request_block(message_text)
    scope_workspace_ids = (
        [
            str(item)
            for item in (intelligence_profile or {}).get("scope_workspace_ids", [])
            if str(item or "").strip()
        ]
        or None
    )
    has_new_attachments = any(str(item).strip() for item in attachment_ids or [])

    try:
        web_supplements, web_sources, search_decision, web_diagnostics = await build_web_supplements_fn(
            message_text,
            workspace_id=workspace_id,
            search_mode=search_mode,
        )
    except Exception:
        logger.exception("Web retrieval setup failed for conversation %s.", conversation_id)
        debug = empty_retrieval_debug(
            "retrieval_failed",
            outcome="failed",
            reason="provider_unavailable",
            failed_channels=["web"],
        )
        return retrieval_unavailable_answer(), [], debug

    def with_common_diagnostics(debug: dict[str, Any]) -> dict[str, Any]:
        diagnostics = debug.get("diagnostics")
        if not isinstance(diagnostics, dict):
            diagnostics = {}
            debug["diagnostics"] = diagnostics
        diagnostics["web_search"] = web_diagnostics
        if intelligence_profile:
            debug["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)
        return debug

    web_search = web_diagnostics.get("search") if isinstance(web_diagnostics, dict) else None
    web_failed = bool(
        search_decision.needs_web
        and isinstance(web_search, dict)
        and web_search.get("ok") is False
    )
    if search_mode == "web":
        if web_supplements:
            prompt, sources, debug = web_only_context(
                message_text,
                workspace_id=workspace_id,
                web_supplements=web_supplements,
            )
            return prompt, merge_sources(sources, web_sources), with_common_diagnostics(debug)
        if web_failed:
            debug = empty_retrieval_debug(
                "web_unavailable",
                outcome="failed",
                reason="provider_unavailable",
                failed_channels=["web"],
            )
            return retrieval_unavailable_answer(), [], with_common_diagnostics(debug)
        debug = empty_retrieval_debug(
            "web_no_relevant_sources",
            outcome="no_relevant_sources",
            reason="no_matches",
        )
        return WEB_NO_RESULTS_ANSWER, [], with_common_diagnostics(debug)

    skip_lightweight_prompt = (
        not has_new_attachments
        and not search_decision.needs_web
        and should_skip_retrieval_for_prompt(message_text)
    )
    if skip_lightweight_prompt and workspace_id and not is_lightweight_conversation(message_text):
        has_documents = has_retrievable_documents_fn or has_retrievable_documents
        try:
            documents_exist = await has_documents(
                user_id=user_id,
                workspace_id=workspace_id,
                scope_workspace_ids=scope_workspace_ids,
            )
        except Exception:
            logger.exception("Document availability check failed for conversation %s.", conversation_id)
            debug = empty_retrieval_debug(
                "retrieval_failed",
                outcome="failed",
                reason="availability_unavailable",
                failed_channels=["availability"],
            )
            return retrieval_unavailable_answer(), [], with_common_diagnostics(debug)
        if documents_exist:
            skip_lightweight_prompt = False

    if skip_lightweight_prompt:
        logger.info(
            "Skipping retrieval for lightweight prompt: conversation_id=%s workspace_id=%s.",
            conversation_id,
            workspace_id,
        )
        return prompt_message, [], with_common_diagnostics(empty_retrieval_debug("lightweight_prompt"))

    uploaded_context_failed = False
    try:
        uploaded_context = await build_uploaded_document_context_fn(
            message_text,
            user_id=user_id,
            conversation_id=conversation_id,
            workspace_id=workspace_id,
            scope_workspace_ids=scope_workspace_ids,
            supplemental_contexts=web_supplements,
        )
        if uploaded_context and uploaded_context.sources:
            if not isinstance(uploaded_context.diagnostics, dict):
                uploaded_context.diagnostics = {}
            uploaded_context.diagnostics["web_search"] = web_diagnostics
            uploaded_context.diagnostics["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)
            debug = retrieval_debug_from_context("uploaded_document", uploaded_context)
            if web_failed:
                debug = apply_channel_failure(debug, channel="web", reason="provider_unavailable")
            return (
                prompt_with_retrieval_coverage_guard(uploaded_context.prompt, str(debug.get("outcome") or "")),
                merge_sources(uploaded_context.sources, web_sources),
                with_common_diagnostics(debug),
            )
    except Exception:
        logger.exception("Uploaded document context retrieval failed for conversation %s.", conversation_id)
        uploaded_context_failed = True

    if DOCUMENT_INTENT_RE.search(message_text):
        try:
            unavailable_files = await find_unavailable_uploaded_documents_fn(
                user_id=user_id,
                conversation_id=conversation_id,
                workspace_id=workspace_id,
                scope_workspace_ids=scope_workspace_ids,
            )
        except Exception:
            logger.exception("Uploaded-document availability lookup failed for conversation %s.", conversation_id)
            debug = empty_retrieval_debug(
                "retrieval_failed",
                outcome="failed",
                reason="availability_unavailable",
                failed_channels=["uploaded_document"],
            )
            return retrieval_unavailable_answer(), [], with_common_diagnostics(debug)
        if unavailable_files:
            debug = empty_retrieval_debug(
                "document_unavailable",
                outcome="source_unavailable",
                reason="source_processing",
            )
            debug["diagnostics"]["unavailable_documents"] = unavailable_files
            return document_unavailable_answer_fn(unavailable_files), [], with_common_diagnostics(debug)

    has_documents = has_retrievable_documents_fn or has_retrievable_documents
    try:
        documents_exist = await has_documents(
            user_id=user_id,
            workspace_id=workspace_id,
            scope_workspace_ids=scope_workspace_ids,
        )
    except Exception:
        logger.exception("Document availability check failed before hybrid retrieval for conversation %s.", conversation_id)
        debug = empty_retrieval_debug(
            "retrieval_failed",
            outcome="failed",
            reason="availability_unavailable",
            failed_channels=["availability"],
        )
        if web_supplements:
            prompt, sources, web_debug = web_only_context(
                message_text,
                workspace_id=workspace_id,
                web_supplements=web_supplements,
            )
            return prompt_with_retrieval_coverage_guard(prompt, "partial"), merge_sources(sources, web_sources), with_common_diagnostics(
                apply_channel_failure(web_debug, channel="availability", reason="availability_unavailable")
            )
        return retrieval_unavailable_answer(), [], with_common_diagnostics(debug)

    if not documents_exist:
        logger.info(
            "Skipping hybrid retrieval because no document chunks exist for conversation %s workspace_id=%s.",
            conversation_id,
            workspace_id,
        )
        if web_supplements:
            prompt, sources, debug = web_only_context(
                message_text,
                workspace_id=workspace_id,
                web_supplements=web_supplements,
            )
            if uploaded_context_failed:
                debug = apply_channel_failure(debug, channel="uploaded_document")
            return prompt_with_retrieval_coverage_guard(prompt, str(debug.get("outcome") or "")), merge_sources(sources, web_sources), with_common_diagnostics(debug)
        debug = empty_retrieval_debug(
            "no_documents",
            outcome="no_relevant_sources",
            reason="no_documents",
        )
        if uploaded_context_failed:
            debug = apply_channel_failure(debug, channel="uploaded_document")
        if debug.get("outcome") == "failed":
            return retrieval_unavailable_answer(), [], with_common_diagnostics(debug)
        return prompt_message, [], with_common_diagnostics(debug)

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
        outcome, reason, failed_channels = hybrid_retrieval_state(response)
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
            retrieval_outcome=outcome,
        )
        response.diagnostics["context"] = built_context.diagnostics
        built_context.diagnostics["web_search"] = web_diagnostics
        built_context.diagnostics["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)

        debug = retrieval_debug_from_context(
            "hybrid",
            built_context,
            outcome=outcome,
            reason=reason,
            failed_channels=failed_channels,
        )
        if web_failed:
            debug = apply_channel_failure(debug, channel="web", reason="provider_unavailable")
        if uploaded_context_failed:
            debug = apply_channel_failure(debug, channel="uploaded_document")
        if built_context.sources:
            return prompt_with_retrieval_coverage_guard(built_context.prompt, str(debug.get("outcome") or "")), merge_sources(built_context.sources, web_sources), with_common_diagnostics(debug)
        if debug.get("outcome") == "failed":
            return retrieval_unavailable_answer(), [], with_common_diagnostics(debug)
        debug = set_retrieval_outcome(
            debug,
            outcome="no_relevant_sources",
            reason="no_matches",
            failed_channels=debug.get("failed_channels"),
        )
        return prompt_message, [], with_common_diagnostics(debug)
    except Exception:
        logger.exception("Hybrid retrieval failed for conversation %s.", conversation_id)

    if web_supplements:
        prompt, sources, debug = web_only_context(
            message_text,
            workspace_id=workspace_id,
            web_supplements=web_supplements,
        )
        debug = apply_channel_failure(debug, channel="hybrid")
        if uploaded_context_failed:
            debug = apply_channel_failure(debug, channel="uploaded_document")
        return prompt_with_retrieval_coverage_guard(prompt, str(debug.get("outcome") or "")), merge_sources(sources, web_sources), with_common_diagnostics(debug)

    debug = empty_retrieval_debug(
        "retrieval_failed",
        outcome="failed",
        reason="hybrid_unavailable",
        failed_channels=["hybrid"],
    )
    if uploaded_context_failed:
        debug = apply_channel_failure(debug, channel="uploaded_document")
    return retrieval_unavailable_answer(), [], with_common_diagnostics(debug)
