from __future__ import annotations

from typing import Any

RETRIEVAL_OUTCOMES = {
    "not_requested",
    "sources_found",
    "no_relevant_sources",
    "partial",
    "failed",
    "source_unavailable",
}
RETRIEVAL_FAILURE_ANSWER = (
    "I couldn't retrieve the requested workspace sources right now, so I can't provide a source-backed answer. "
    "Please try again shortly."
)
WEB_NO_RESULTS_ANSWER = (
    "I couldn't find relevant web sources for that request. Try a more specific search or ask a question "
    "that does not require current web information."
)
_PUBLIC_REASONS = {
    "not_requested",
    "sources_found",
    "no_matches",
    "no_documents",
    "channel_failure",
    "channel_timeout",
    "provider_unavailable",
    "availability_unavailable",
    "hybrid_unavailable",
    "source_processing",
}
_PUBLIC_CHANNELS = {
    "semantic",
    "keyword",
    "reranker",
    "routing",
    "hybrid",
    "web",
    "uploaded_document",
    "availability",
}


def retrieval_unavailable_answer() -> str:
    return RETRIEVAL_FAILURE_ANSWER


def prompt_with_retrieval_coverage_guard(prompt: str, outcome: str) -> str:
    if outcome != "partial":
        return prompt
    return (
        f"{prompt}\n\nSOURCE RETRIEVAL COVERAGE:\n"
        "Some retrieval channels were unavailable. Use only the supplied sources and do not imply complete "
        "workspace coverage or source-backed certainty beyond them."
    )


def public_retrieval_payload(
    retrieval_debug: dict[str, Any] | None,
    sources: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not isinstance(retrieval_debug, dict):
        return None
    outcome = str(retrieval_debug.get("outcome") or "")
    if outcome not in RETRIEVAL_OUTCOMES:
        return None
    payload: dict[str, Any] = {"outcome": outcome, "source_count": min(len(sources), 12)}
    reason = str(retrieval_debug.get("reason") or "")
    if reason in _PUBLIC_REASONS:
        payload["reason"] = reason
    channels = retrieval_debug.get("failed_channels")
    if isinstance(channels, list):
        failed_channels = [str(channel) for channel in channels if str(channel) in _PUBLIC_CHANNELS][:8]
        if failed_channels:
            payload["failed_channels"] = failed_channels
    return payload


def should_bypass_model_for_retrieval(debug: dict[str, Any] | None) -> bool:
    if not isinstance(debug, dict):
        return False
    return debug.get("strategy") in {
        "document_unavailable",
        "retrieval_failed",
        "web_unavailable",
        "web_no_relevant_sources",
    }


def set_retrieval_outcome(
    debug: dict[str, Any],
    *,
    outcome: str,
    reason: str | None = None,
    failed_channels: list[str] | None = None,
) -> dict[str, Any]:
    normalized_outcome = outcome if outcome in RETRIEVAL_OUTCOMES else "failed"
    allowed_channels = {"semantic", "keyword", "reranker", "routing", "hybrid", "web", "uploaded_document", "availability"}
    normalized_channels = [
        str(channel)
        for channel in (failed_channels or [])
        if str(channel) in allowed_channels
    ]
    debug["outcome"] = normalized_outcome
    debug["reason"] = reason or {
        "not_requested": "not_requested",
        "sources_found": "sources_found",
        "no_relevant_sources": "no_matches",
        "partial": "channel_failure",
        "failed": "channel_failure",
        "source_unavailable": "source_processing",
    }[normalized_outcome]
    debug["failed_channels"] = normalized_channels
    return debug


def apply_channel_failure(
    debug: dict[str, Any],
    *,
    channel: str,
    reason: str = "channel_failure",
) -> dict[str, Any]:
    existing_channels = [str(item) for item in debug.get("failed_channels", [])]
    if channel not in existing_channels:
        existing_channels.append(channel)
    source_count = int(debug.get("retrieved_chunks_count") or 0)
    outcome = "partial" if source_count else "failed"
    return set_retrieval_outcome(
        debug,
        outcome=outcome,
        reason=reason,
        failed_channels=existing_channels,
    )


def hybrid_retrieval_state(response: Any) -> tuple[str, str, list[str]]:
    diagnostics = getattr(response, "diagnostics", {})
    retrieval = diagnostics.get("retrieval") if isinstance(diagnostics, dict) else {}
    retrieval = retrieval if isinstance(retrieval, dict) else {}
    outcome = str(retrieval.get("outcome") or "failed")
    if outcome not in {"sources_found", "no_relevant_sources", "partial", "failed"}:
        outcome = "failed"
    reason = str(retrieval.get("reason") or "channel_failure")
    failed_channels = [
        str(channel)
        for channel in retrieval.get("failed_channels", [])
        if str(channel) in {"semantic", "keyword", "reranker"}
    ]
    return outcome, reason, failed_channels
