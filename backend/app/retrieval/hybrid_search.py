from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from dataclasses import dataclass, field
import logging
import time
from typing import Any

from ..core.config import get_settings
from ..observability.safe_logging import safe_text_preview
from ..rag.startup import get_vector_store
from ..rag.vector_store_base import VectorStore
from .context_builder import BuiltContext, ContextBuilder
from .keyword_search import KeywordSearch
from .outcomes import RetrievalChannelError
from .reranker import Reranker, ScoreBasedReranker
from .scoring import (
    DEFAULT_KEYWORD_WEIGHT,
    DEFAULT_SEMANTIC_WEIGHT,
    QueryAnalysis,
    RetrievalResult,
    analyze_query,
    normalize_channel_scores,
    normalize_weights,
)
from .semantic_search import SemanticSearch

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class HybridSearchConfig:
    top_k: int = 3
    semantic_pool_size: int = 6
    keyword_pool_size: int = 6
    semantic_weight: float = DEFAULT_SEMANTIC_WEIGHT
    keyword_weight: float = DEFAULT_KEYWORD_WEIGHT
    dynamic_weighting: bool = True
    semantic_distance_threshold: float | None = None
    context_token_budget: int = 2600
    context_max_chunk_tokens: int = 650
    channel_timeout_seconds: float = 12.0
    dev_diagnostics: bool = True

    @classmethod
    def from_settings(cls) -> "HybridSearchConfig":
        settings = get_settings()
        semantic_weight, keyword_weight = normalize_weights(
            getattr(settings, "HYBRID_SEMANTIC_WEIGHT", DEFAULT_SEMANTIC_WEIGHT),
            getattr(settings, "HYBRID_KEYWORD_WEIGHT", DEFAULT_KEYWORD_WEIGHT),
        )
        top_k = max(1, int(getattr(settings, "HYBRID_TOP_K", 3)))
        pool_size = max(top_k * 2, int(getattr(settings, "HYBRID_POOL_SIZE", top_k * 2)))
        return cls(
            top_k=top_k,
            semantic_pool_size=pool_size,
            keyword_pool_size=pool_size,
            semantic_weight=semantic_weight,
            keyword_weight=keyword_weight,
            dynamic_weighting=bool(getattr(settings, "HYBRID_DYNAMIC_WEIGHTING", True)),
            semantic_distance_threshold=getattr(settings, "SIMILARITY_THRESHOLD", None),
            context_token_budget=int(getattr(settings, "HYBRID_CONTEXT_TOKEN_BUDGET", 2600)),
            context_max_chunk_tokens=int(getattr(settings, "HYBRID_MAX_CHUNK_TOKENS", 650)),
            channel_timeout_seconds=max(
                0.1,
                min(float(getattr(settings, "HYBRID_CHANNEL_TIMEOUT_SECONDS", 12.0)), 60.0),
            ),
            dev_diagnostics=bool(getattr(settings, "DEV_MODE", False)),
        )


@dataclass(slots=True)
class HybridSearchResponse:
    query: str
    results: list[RetrievalResult]
    analysis: QueryAnalysis
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "results": [result.to_dict() for result in self.results],
            "analysis": self.analysis.to_dict(),
            "diagnostics": self.diagnostics,
        }


@dataclass(slots=True)
class _ChannelOutcome:
    status: str
    results: list[RetrievalResult]
    latency_ms: float
    error_code: str | None = None

    def to_diagnostics(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": self.status,
            "result_count": len(self.results),
            "latency_ms": round(self.latency_ms, 2),
        }
        if self.error_code:
            payload["error_code"] = self.error_code
        return payload


class HybridSearchEngine:
    """Hybrid retrieval orchestrator for semantic search, keyword search, fusion, and reranking."""

    def __init__(
        self,
        vector_store: VectorStore | None = None,
        *,
        semantic_search: SemanticSearch | None = None,
        keyword_search: KeywordSearch | None = None,
        reranker: Reranker | None = None,
        context_builder: ContextBuilder | None = None,
        config: HybridSearchConfig | None = None,
    ) -> None:
        self.config = config or HybridSearchConfig.from_settings()
        self.vector_store = vector_store
        if semantic_search is None:
            self.vector_store = self.vector_store or get_vector_store()
            semantic_search = SemanticSearch(self.vector_store)
        self.semantic_search = semantic_search
        self.keyword_search = keyword_search or KeywordSearch()
        self.reranker = reranker or ScoreBasedReranker()
        self.context_builder = context_builder or ContextBuilder(
            max_chunks=self.config.top_k,
            token_budget=self.config.context_token_budget,
            max_chunk_tokens=self.config.context_max_chunk_tokens,
        )

    async def search(
        self,
        query: str,
        *,
        user_id: str,
        workspace_id: str | list[str] | None = None,
        top_k: int | None = None,
    ) -> HybridSearchResponse:
        started_at = time.perf_counter()
        final_top_k = max(1, top_k or self.config.top_k)
        semantic_top_k = max(final_top_k, self.config.semantic_pool_size)
        keyword_top_k = max(final_top_k, self.config.keyword_pool_size)

        analysis = analyze_query(
            query,
            base_semantic_weight=self.config.semantic_weight,
            base_keyword_weight=self.config.keyword_weight,
        )
        if self.config.dynamic_weighting:
            semantic_weight, keyword_weight = analysis.semantic_weight, analysis.keyword_weight
        else:
            semantic_weight, keyword_weight = normalize_weights(self.config.semantic_weight, self.config.keyword_weight)

        semantic_outcome, keyword_outcome = await asyncio.gather(
            self._run_channel(
                "semantic",
                self.semantic_search.search(
                    query,
                    user_id=user_id,
                    workspace_id=workspace_id,
                    top_k=semantic_top_k,
                    distance_threshold=self.config.semantic_distance_threshold,
                ),
            ),
            self._run_channel(
                "keyword",
                self.keyword_search.search(
                    query,
                    user_id=user_id,
                    workspace_id=workspace_id,
                    top_k=keyword_top_k,
                ),
            ),
        )

        semantic_results = semantic_outcome.results
        keyword_results = keyword_outcome.results
        merged = self._merge_results(
            semantic_results,
            keyword_results,
            semantic_weight=semantic_weight,
            keyword_weight=keyword_weight,
        )
        reranker_outcome: _ChannelOutcome | None = None
        try:
            reranked = await self.reranker.rerank(query, merged, analysis=analysis)
            final_results = reranked[:final_top_k]
        except Exception:
            logger.exception("Reranker failed during hybrid search.")
            reranker_outcome = _ChannelOutcome(
                status="failed",
                results=[],
                latency_ms=0.0,
                error_code="reranker_unavailable",
            )
            final_results = []
        latency_ms = (time.perf_counter() - started_at) * 1000

        channels: dict[str, _ChannelOutcome] = {
            "semantic": semantic_outcome,
            "keyword": keyword_outcome,
        }
        if reranker_outcome:
            channels["reranker"] = reranker_outcome
        retrieval_outcome, retrieval_reason = self._retrieval_outcome(channels, final_results)
        failed_channels = [
            name
            for name, outcome in channels.items()
            if outcome.status in {"failed", "timed_out"}
        ]

        diagnostics = {
            "latency_ms": round(latency_ms, 2),
            "semantic_matches": len(semantic_results),
            "keyword_matches": len(keyword_results),
            "merged_matches": len(merged),
            "returned_matches": len(final_results),
            "semantic_weight": semantic_weight,
            "keyword_weight": keyword_weight,
            "analysis": analysis.to_dict(),
            "retrieval": {
                "outcome": retrieval_outcome,
                "reason": retrieval_reason,
                "failed_channels": failed_channels,
                "channels": {
                    name: outcome.to_diagnostics()
                    for name, outcome in channels.items()
                },
            },
            "semantic": [self._diagnostic_row(result) for result in semantic_results],
            "keyword": [self._diagnostic_row(result) for result in keyword_results],
            "merged": [self._diagnostic_row(result) for result in merged],
            "reranked": [self._diagnostic_row(result) for result in final_results],
        }
        response = HybridSearchResponse(
            query=query,
            results=final_results,
            analysis=analysis,
            diagnostics=diagnostics,
        )
        self._log_diagnostics(response)
        return response

    async def build_context(
        self,
        query: str,
        *,
        user_id: str,
        workspace_id: str | list[str] | None = None,
        top_k: int | None = None,
    ) -> tuple[HybridSearchResponse, BuiltContext]:
        response = await self.search(query, user_id=user_id, workspace_id=workspace_id, top_k=top_k)
        built = self.context_builder.build(
            query,
            response.results,
            workspace_id=workspace_id,
            retrieval_outcome=str(response.diagnostics.get("retrieval", {}).get("outcome") or "sources_found"),
        )
        response.diagnostics["context"] = built.diagnostics
        return response, built

    async def _run_channel(
        self,
        channel: str,
        operation: Awaitable[list[RetrievalResult]],
    ) -> _ChannelOutcome:
        started_at = time.perf_counter()
        try:
            results = await asyncio.wait_for(
                operation,
                timeout=max(0.1, float(self.config.channel_timeout_seconds)),
            )
        except TimeoutError:
            latency_ms = (time.perf_counter() - started_at) * 1000
            logger.warning("%s retrieval timed out after %.2fms.", channel, latency_ms)
            return _ChannelOutcome(
                status="timed_out",
                results=[],
                latency_ms=latency_ms,
                error_code="timeout",
            )
        except RetrievalChannelError as exc:
            latency_ms = (time.perf_counter() - started_at) * 1000
            logger.error(
                "%s retrieval failed during hybrid search.",
                channel,
                exc_info=(type(exc), exc, exc.__traceback__),
            )
            return _ChannelOutcome(
                status="failed",
                results=[],
                latency_ms=latency_ms,
                error_code=exc.code,
            )
        except Exception as exc:
            latency_ms = (time.perf_counter() - started_at) * 1000
            logger.error(
                "%s retrieval failed during hybrid search.",
                channel,
                exc_info=(type(exc), exc, exc.__traceback__),
            )
            return _ChannelOutcome(
                status="failed",
                results=[],
                latency_ms=latency_ms,
                error_code="unexpected_error",
            )

        latency_ms = (time.perf_counter() - started_at) * 1000
        if not isinstance(results, list):
            logger.error("%s retrieval returned an invalid result payload.", channel)
            return _ChannelOutcome(
                status="failed",
                results=[],
                latency_ms=latency_ms,
                error_code="invalid_result",
            )
        return _ChannelOutcome(
            status="ok" if results else "empty",
            results=results,
            latency_ms=latency_ms,
        )

    @staticmethod
    def _retrieval_outcome(
        channels: dict[str, _ChannelOutcome],
        final_results: list[RetrievalResult],
    ) -> tuple[str, str]:
        failures = [outcome for outcome in channels.values() if outcome.status in {"failed", "timed_out"}]
        if failures:
            reason = "channel_timeout" if any(outcome.status == "timed_out" for outcome in failures) else "channel_failure"
            return ("partial", reason) if final_results else ("failed", reason)
        return ("sources_found", "sources_found") if final_results else ("no_relevant_sources", "no_matches")

    @staticmethod
    def _merge_results(
        semantic_results: list[RetrievalResult],
        keyword_results: list[RetrievalResult],
        *,
        semantic_weight: float,
        keyword_weight: float,
    ) -> list[RetrievalResult]:
        semantic_norm = normalize_channel_scores(semantic_results, "semantic")
        keyword_norm = normalize_channel_scores(keyword_results, "keyword")
        merged: dict[str, RetrievalResult] = {}

        for result in semantic_results:
            key = result.key()
            candidate = result.clone()
            raw_score = candidate.semantic_score
            candidate.diagnostics["raw_semantic_score"] = raw_score
            candidate.semantic_score = semantic_norm.get(key, 0.0)
            candidate.score = semantic_weight * candidate.semantic_score
            candidate.sources.add("semantic")
            merged[key] = candidate

        for result in keyword_results:
            key = result.key()
            raw_score = result.keyword_score
            normalized_keyword = keyword_norm.get(key, 0.0)
            if key not in merged:
                candidate = result.clone()
                candidate.diagnostics["raw_keyword_score"] = raw_score
                candidate.keyword_score = normalized_keyword
                candidate.score = keyword_weight * candidate.keyword_score
                candidate.sources.add("keyword")
                merged[key] = candidate
                continue

            existing = merged[key]
            existing.keyword_score = max(existing.keyword_score, normalized_keyword)
            existing.score += keyword_weight * existing.keyword_score
            existing.sources.add("keyword")
            existing.rank = result.rank
            existing.diagnostics["raw_keyword_score"] = raw_score
            if not existing.file_name or existing.file_name == "Unknown File":
                existing.file_name = result.file_name
            if not existing.metadata and result.metadata:
                existing.metadata = result.metadata

        merged_results = list(merged.values())
        merged_results.sort(
            key=lambda item: (
                item.score,
                item.keyword_score,
                item.semantic_score,
            ),
            reverse=True,
        )
        return merged_results

    @staticmethod
    def _diagnostic_row(result: RetrievalResult) -> dict[str, Any]:
        return {
            "chunk_id": result.chunk_id,
            "file_id": result.file_id,
            "file_name": result.file_name,
            "score": result.rerank_score if result.rerank_score is not None else result.score,
            "semantic_score": result.semantic_score,
            "keyword_score": result.keyword_score,
            "distance": result.distance,
            "rank": result.rank,
            "sources": sorted(result.sources),
        }

    def _log_diagnostics(self, response: HybridSearchResponse) -> None:
        log_level = logging.INFO if self.config.dev_diagnostics else logging.DEBUG
        if not logger.isEnabledFor(log_level):
            return
        diagnostics = response.diagnostics
        retrieval = diagnostics.get("retrieval") if isinstance(diagnostics.get("retrieval"), dict) else {}
        logger.log(
            log_level,
            "Hybrid retrieval diagnostics: query=%r semantic=%d keyword=%d merged=%d returned=%d "
            "weights=(semantic=%.2f keyword=%.2f) latency_ms=%.2f outcome=%s failed_channels=%s reasons=%s",
            safe_text_preview(response.query, max_chars=240),
            diagnostics.get("semantic_matches", 0),
            diagnostics.get("keyword_matches", 0),
            diagnostics.get("merged_matches", 0),
            diagnostics.get("returned_matches", 0),
            diagnostics.get("semantic_weight", 0.0),
            diagnostics.get("keyword_weight", 0.0),
            diagnostics.get("latency_ms", 0.0),
            retrieval.get("outcome", "unknown"),
            retrieval.get("failed_channels", []),
            response.analysis.reasons,
        )
        logger.log(log_level, "Hybrid semantic matches: %s", diagnostics.get("semantic", []))
        logger.log(log_level, "Hybrid keyword matches: %s", diagnostics.get("keyword", []))
        logger.log(log_level, "Hybrid merged ranking: %s", diagnostics.get("merged", []))
        logger.log(log_level, "Hybrid retrieval reranked output: %s", diagnostics.get("reranked", []))
