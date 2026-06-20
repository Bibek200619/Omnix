from __future__ import annotations

from collections.abc import Awaitable, Callable
import logging
import re
from typing import Any

from ..observability.safe_logging import safe_text_preview
from .document_context_service import build_uploaded_document_context, find_unavailable_uploaded_documents
from .query_classifier import SearchDecision, SearchMode, classify_search_need
from .supabase_service import select_all, select_all_trusted
from .web_search import WebSearchResponse, get_web_search_service
from .workspace_intelligence_service import build_workspace_intelligence_profile

logger = logging.getLogger(__name__)

DOCUMENT_INTENT_RE = re.compile(
    r"\b(file|document|doc|pdf|docx|upload|attached|attachment|summari[sz]e|analy[sz]e|resume|contract|report|context|source)\b",
    re.IGNORECASE,
)

BuildWebSupplementsFn = Callable[..., Awaitable[tuple[list[Any], list[dict[str, Any]], SearchDecision, dict[str, Any]]]]
UploadedContextFn = Callable[..., Awaitable[Any]]
UnavailableDocumentsFn = Callable[..., Awaitable[list[dict[str, Any]]]]
HasRetrievableDocumentsFn = Callable[..., Awaitable[bool]]
WorkspaceIntelligenceFn = Callable[[str, str], Awaitable[dict[str, Any] | None]]


def retrieval_debug_from_context(strategy: str, built_context: Any) -> dict[str, Any]:
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
        "first_chunk_preview": safe_text_preview(preview, max_chars=240),
        "diagnostics": getattr(built_context, "diagnostics", {}),
    }


def empty_retrieval_debug(strategy: str = "none") -> dict[str, Any]:
    return {
        "strategy": strategy,
        "retrieved_chunks_count": 0,
        "first_chunk_preview": "",
        "diagnostics": {},
    }


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


def merge_sources(*source_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
    web_supplements, web_sources, search_decision, web_diagnostics = await build_web_supplements_fn(
        message_text,
        workspace_id=workspace_id,
        search_mode=search_mode,
    )
    if search_mode == "web":
        if web_supplements:
            prompt, sources, debug = web_only_context(
                message_text,
                workspace_id=workspace_id,
                web_supplements=web_supplements,
            )
            debug["diagnostics"]["web_search"] = web_diagnostics
            return prompt, merge_sources(sources, web_sources), debug
        debug = empty_retrieval_debug("web_unavailable")
        debug["diagnostics"]["web_search"] = web_diagnostics
        if intelligence_profile:
            debug["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)
        return prompt_message, [], debug

    if (
        not has_new_attachments
        and not search_decision.needs_web
        and should_skip_retrieval_for_prompt(message_text)
    ):
        logger.info(
            "Skipping retrieval for lightweight prompt: conversation_id=%s workspace_id=%s.",
            conversation_id,
            workspace_id,
        )
        debug = empty_retrieval_debug("lightweight_prompt")
        debug["diagnostics"]["web_search"] = web_diagnostics
        if intelligence_profile:
            debug["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)
        return prompt_message, [], debug

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
            uploaded_context.diagnostics["web_search"] = web_diagnostics
            uploaded_context.diagnostics["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)
            return (
                uploaded_context.prompt,
                merge_sources(uploaded_context.sources, web_sources),
                retrieval_debug_from_context("uploaded_document", uploaded_context),
            )
    except Exception as exc:
        logger.exception("Uploaded document context retrieval failed for conversation %s: %s", conversation_id, exc)

    if DOCUMENT_INTENT_RE.search(message_text):
        unavailable_files = await find_unavailable_uploaded_documents_fn(
            user_id=user_id,
            conversation_id=conversation_id,
            workspace_id=workspace_id,
            scope_workspace_ids=scope_workspace_ids,
        )
        if unavailable_files:
            debug = empty_retrieval_debug("document_unavailable")
            debug["diagnostics"]["web_search"] = web_diagnostics
            debug["diagnostics"]["unavailable_documents"] = unavailable_files
            if intelligence_profile:
                debug["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)
            return document_unavailable_answer_fn(unavailable_files), [], debug

    has_documents = has_retrievable_documents_fn or has_retrievable_documents
    if not await has_documents(
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
            prompt, sources, debug = web_only_context(
                message_text,
                workspace_id=workspace_id,
                web_supplements=web_supplements,
            )
            debug["diagnostics"]["web_search"] = web_diagnostics
            return prompt, merge_sources(sources, web_sources), debug
        debug = empty_retrieval_debug("no_documents")
        debug["diagnostics"]["web_search"] = web_diagnostics
        if intelligence_profile:
            debug["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)
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
        built_context.diagnostics["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)

        if built_context.sources:
            return (
                built_context.prompt,
                merge_sources(built_context.sources, web_sources),
                retrieval_debug_from_context("hybrid", built_context),
            )
    except Exception as exc:
        logger.exception("Hybrid retrieval failed for conversation %s: %s", conversation_id, exc)

    if web_supplements:
        prompt, sources, debug = web_only_context(
            message_text,
            workspace_id=workspace_id,
            web_supplements=web_supplements,
        )
        debug["diagnostics"]["web_search"] = web_diagnostics
        return prompt, merge_sources(sources, web_sources), debug

    debug = empty_retrieval_debug()
    debug["diagnostics"]["web_search"] = web_diagnostics
    if intelligence_profile:
        debug["workspace_intelligence"] = compact_intelligence_debug(intelligence_profile)
    return prompt_message, [], debug


def compact_intelligence_debug(profile: dict[str, Any] | None) -> dict[str, Any] | None:
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


async def load_workspace_intelligence_for_chat(
    workspace_id: str | None,
    user_id: str,
    *,
    build_workspace_intelligence_profile_fn: WorkspaceIntelligenceFn = build_workspace_intelligence_profile,
) -> dict[str, Any] | None:
    if not workspace_id:
        return None
    try:
        return await build_workspace_intelligence_profile_fn(workspace_id, user_id)
    except Exception:
        logger.exception("Failed to load workspace intelligence profile for chat; continuing with generic AI context.")
        return None


async def has_retrievable_documents(
    *,
    user_id: str,
    workspace_id: str | None,
    scope_workspace_ids: list[str] | None = None,
    select_all_fn: Callable[..., Awaitable[list[dict[str, Any]]]] = select_all,
    select_all_trusted_fn: Callable[..., Awaitable[list[dict[str, Any]]]] = select_all_trusted,
) -> bool:
    try:
        workspace_ids = [
            str(item)
            for item in (scope_workspace_ids or ([workspace_id] if workspace_id else []))
            if str(item or "").strip()
        ]
        if workspace_ids:
            rows = await select_all_trusted_fn(
                "documents",
                "id,workspace_id",
                filters={"workspace_id": workspace_ids},
                limit=1,
            )
            scope_set = set(workspace_ids)
            return any(str(row.get("workspace_id") or "") in scope_set for row in rows)

        rows = await select_all_fn(
            "documents",
            "id,workspace_id",
            filters={"user_id": user_id},
            limit=1,
        )
        return any(not row.get("workspace_id") for row in rows)
    except Exception:
        logger.exception("Unable to check document availability; allowing hybrid retrieval fallback.")
        return True
