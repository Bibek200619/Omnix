from __future__ import annotations

from collections.abc import Awaitable, Callable
import logging
from typing import Any

from .citation_validation_service import pending_citation_validation, validate_generated_citations
from .query_classifier import SearchMode
from .retrieval_state import public_retrieval_payload
from .supabase_service import SupabaseServiceError, update_one, update_one_trusted

logger = logging.getLogger(__name__)

UpdateMessageFn = Callable[[str, dict[str, Any], dict[str, Any]], Awaitable[dict[str, Any] | None]]


def compact_text(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    if not text:
        return None
    return text[:limit]


def compact_sources_for_payload(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    safe_sources: list[dict[str, Any]] = []
    for source in sources[:12]:
        if not isinstance(source, dict):
            continue

        snippet = compact_text(
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
            text = compact_text(source.get(key), limit)
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


def sources_from_container(container: Any) -> list[dict[str, Any]]:
    if not isinstance(container, dict):
        return []
    sources = container.get("sources")
    if not isinstance(sources, list):
        return []
    return [source for source in sources if isinstance(source, dict)]


def message_sources(message: dict[str, Any]) -> list[dict[str, Any]]:
    payload_sources = sources_from_container(message.get("payload"))
    if payload_sources:
        return payload_sources
    return sources_from_container(message.get("metadata"))


def with_sources_payload(message: dict[str, Any]) -> dict[str, Any]:
    sources = message_sources(message)
    if not sources:
        return message
    return {**message, "sources": sources}


def mode_from_retrieval_debug(
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


def assistant_message_payload(
    *,
    sources: list[dict[str, Any]],
    search_mode: SearchMode,
    retrieval_debug: dict[str, Any] | None,
    content: str | None = None,
) -> dict[str, Any]:
    compact_sources = compact_sources_for_payload(sources)
    mode = mode_from_retrieval_debug(search_mode, retrieval_debug, compact_sources)
    web_search_used = any(source.get("type") == "web" or source.get("url") for source in compact_sources)
    citation_validation = (
        validate_generated_citations(content, compact_sources)
        if content is not None
        else pending_citation_validation(compact_sources)
    )
    payload: dict[str, Any] = {
        "mode": mode,
        "web_search_used": web_search_used,
        "sources": compact_sources,
        "citations": list(citation_validation.citations),
        "citation_validation": citation_validation.public_payload,
    }
    retrieval = public_retrieval_payload(retrieval_debug, compact_sources)
    if retrieval:
        payload["retrieval"] = retrieval
    return payload


def has_persistable_payload(payload: dict[str, Any]) -> bool:
    sources = payload.get("sources")
    return bool(
        payload.get("web_search_used")
        or (isinstance(sources, list) and sources)
        or isinstance(payload.get("retrieval"), dict)
    )


async def persist_assistant_payload(
    *,
    assistant_message_id: str,
    user_id: str,
    sources: list[dict[str, Any]],
    search_mode: SearchMode,
    retrieval_debug: dict[str, Any] | None,
    stage: str,
    update_one_trusted_fn: UpdateMessageFn = update_one_trusted,
) -> dict[str, Any] | None:
    message_payload = assistant_message_payload(
        sources=sources,
        search_mode=search_mode,
        retrieval_debug=retrieval_debug,
    )
    if not has_persistable_payload(message_payload):
        return None

    logger.info(
        "Persisting assistant payload: stage=%s assistant_message_id=%s mode=%s web_search_used=%s source_count=%d retrieval_outcome=%s",
        stage,
        assistant_message_id,
        message_payload.get("mode"),
        message_payload.get("web_search_used"),
        len(message_payload.get("sources") or []),
        (message_payload.get("retrieval") or {}).get("outcome") if isinstance(message_payload.get("retrieval"), dict) else None,
    )

    try:
        updated = await update_one_trusted_fn(
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
    if not has_persistable_payload(persisted_payload if isinstance(persisted_payload, dict) else {}):
        logger.warning(
            "Assistant payload update returned without persisted metadata: stage=%s assistant_message_id=%s",
            stage,
            assistant_message_id,
        )
    return updated


async def update_assistant_message(
    *,
    assistant_message_id: str,
    user_id: str,
    content: str,
    status_value: str,
    sources: list[dict[str, Any]] | None = None,
    search_mode: SearchMode = "auto",
    retrieval_debug: dict[str, Any] | None = None,
    update_one_fn: UpdateMessageFn = update_one,
) -> dict[str, Any] | None:
    payload: dict[str, Any] = {"content": content, "status": status_value}
    if sources is not None:
        content = validate_generated_citations(content, sources).content
        payload["content"] = content
        message_payload = assistant_message_payload(
            sources=sources,
            search_mode=search_mode,
            retrieval_debug=retrieval_debug,
            content=content,
        )
        if has_persistable_payload(message_payload):
            payload["payload"] = message_payload

    try:
        return await update_one_fn(
            "messages",
            {"id": assistant_message_id, "user_id": user_id},
            payload,
        )
    except SupabaseServiceError:
        if "payload" not in payload:
            raise
        logger.warning("Message payload column unavailable; trying legacy metadata before finalizing without sources.")
        try:
            return await update_one_fn(
                "messages",
                {"id": assistant_message_id, "user_id": user_id},
                {
                    "content": content,
                    "status": status_value,
                    "metadata": {
                        "sources": payload["payload"]["sources"],
                        "citations": payload["payload"]["citations"],
                        "citation_validation": payload["payload"]["citation_validation"],
                        **(
                            {"retrieval": payload["payload"]["retrieval"]}
                            if isinstance(payload["payload"].get("retrieval"), dict)
                            else {}
                        ),
                    },
                },
            )
        except SupabaseServiceError:
            logger.warning("Message metadata column unavailable; finalizing assistant message without persisted sources.")
            return await update_one_fn(
                "messages",
                {"id": assistant_message_id, "user_id": user_id},
                {"content": content, "status": status_value},
            )
