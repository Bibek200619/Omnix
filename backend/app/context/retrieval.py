from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .schemas import ContextPayload, Citation, ContextSourceType
from ..rag.startup import get_vector_store
from ..retrieval.hybrid_search import HybridSearchEngine
from ..retrieval.router import intelligence_router

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RetrievalOutcome:
    """Safe retrieval state for context-engine consumers.

    ``diagnostics`` is deliberately limited to enum-like status data and counts;
    provider exception messages stay in server logs.
    """

    citations: list[Citation] = field(default_factory=list)
    outcome: str = "not_requested"
    diagnostics: dict[str, Any] = field(default_factory=dict)


class RetrievalManager:
    """
    Centralizes federated semantic, keyword, and hybrid retrieval operations.
    Uses the IntelligenceRouter to determine the optimal retrieval scope.
    """

    def __init__(self, vector_store=None):
        self.vector_store = vector_store or get_vector_store()
        self.hybrid_engine = HybridSearchEngine(self.vector_store)

    async def retrieve(
        self, payload: ContextPayload, top_k: int = 3
    ) -> RetrievalOutcome:
        """Orchestrate retrieval across federated workspace scopes."""
        if not payload.query or not payload.query.strip():
            logger.warning("Empty query provided to RetrievalManager.")
            return RetrievalOutcome(
                outcome="not_requested",
                diagnostics={"outcome": "not_requested", "reason": "empty_query", "failed_channels": []},
            )

        try:
            # 1. Determine optimal retrieval scope via Intelligence Router
            routing = await intelligence_router.route_query(payload)
            scope_ids = routing.get("scope_ids", [])
        except Exception:
            logger.exception("RetrievalManager failed while resolving the federated retrieval scope.")
            return RetrievalOutcome(
                outcome="failed",
                diagnostics={"outcome": "failed", "reason": "routing_unavailable", "failed_channels": ["routing"]},
            )

        try:
            # 2. Execute hybrid search across the determined scope
            response = await self.hybrid_engine.search(
                payload.query,
                user_id=payload.user_id,
                workspace_id=scope_ids, # Passing list for federated search
                top_k=top_k,
            )
        except Exception:
            logger.exception("RetrievalManager failed during federated search.")
            return RetrievalOutcome(
                outcome="failed",
                diagnostics={"outcome": "failed", "reason": "hybrid_unavailable", "failed_channels": ["hybrid"]},
            )

        retrieval_diagnostics = _safe_retrieval_diagnostics(response.diagnostics.get("retrieval"))
        citations = [
            Citation(
                source_id=res.chunk_id,
                source_type=ContextSourceType.RETRIEVAL,
                content=res.content,
                file_id=res.file_id,
                file_name=res.file_name or "Unknown File",
                metadata={
                    **(res.metadata or {}),
                    "routing": routing,
                },
                score=res.score,
            )
            for res in response.results
        ]
        return RetrievalOutcome(
            citations=citations,
            outcome=str(retrieval_diagnostics["outcome"]),
            diagnostics=retrieval_diagnostics,
        )


def _safe_retrieval_diagnostics(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    outcome = str(raw.get("outcome") or "failed")
    if outcome not in {"sources_found", "no_relevant_sources", "partial", "failed"}:
        outcome = "failed"
    reason = str(raw.get("reason") or "channel_failure")
    allowed_reasons = {
        "sources_found",
        "no_matches",
        "channel_failure",
        "channel_timeout",
        "routing_unavailable",
        "hybrid_unavailable",
    }
    if reason not in allowed_reasons:
        reason = "channel_failure"
    failed_channels = [
        str(channel)
        for channel in raw.get("failed_channels", [])
        if str(channel) in {"semantic", "keyword", "reranker", "routing", "hybrid"}
    ]
    return {
        "outcome": outcome,
        "reason": reason,
        "failed_channels": failed_channels,
    }
