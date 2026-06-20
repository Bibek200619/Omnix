from __future__ import annotations

import asyncio
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

        semantic_task = self.semantic_search.search(
            query,
            user_id=user_id,
            workspace_id=workspace_id,
            top_k=semantic_top_k,
            distance_threshold=self.config.semantic_distance_threshold,
        )
        keyword_task = self.keyword_search.search(
            query,
            user_id=user_id,
            workspace_id=workspace_id,
            top_k=keyword_top_k,
        )
        semantic_result, keyword_result = await asyncio.gather(
            semantic_task,
            keyword_task,
            return_exceptions=True,
        )

        semantic_results = self._coerce_results("semantic", semantic_result)
        keyword_results = self._coerce_results("keyword", keyword_result)
        merged = self._merge_results(
            semantic_results,
            keyword_results,
            semantic_weight=semantic_weight,
            keyword_weight=keyword_weight,
        )
        reranked = await self.reranker.rerank(query, merged, analysis=analysis)
        final_results = reranked[:final_top_k]
        latency_ms = (time.perf_counter() - started_at) * 1000

        diagnostics = {
            "latency_ms": round(latency_ms, 2),
            "semantic_matches": len(semantic_results),
            "keyword_matches": len(keyword_results),
            "merged_matches": len(merged),
            "returned_matches": len(final_results),
            "semantic_weight": semantic_weight,
            "keyword_weight": keyword_weight,
            "analysis": analysis.to_dict(),
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
        built = self.context_builder.build(query, response.results, workspace_id=workspace_id)
        response.diagnostics["context"] = built.diagnostics
        return response, built

    @staticmethod
    def _coerce_results(channel: str, result: list[RetrievalResult] | BaseException) -> list[RetrievalResult]:
        if isinstance(result, BaseException):
            logger.error(
                "%s retrieval failed during hybrid search.",
                channel,
                exc_info=(type(result), result, result.__traceback__),
            )
            return []
        return result

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
        logger.log(
            log_level,
            "Hybrid retrieval diagnostics: query=%r semantic=%d keyword=%d merged=%d returned=%d "
            "weights=(semantic=%.2f keyword=%.2f) latency_ms=%.2f reasons=%s",
            safe_text_preview(response.query, max_chars=240),
            diagnostics.get("semantic_matches", 0),
            diagnostics.get("keyword_matches", 0),
            diagnostics.get("merged_matches", 0),
            diagnostics.get("returned_matches", 0),
            diagnostics.get("semantic_weight", 0.0),
            diagnostics.get("keyword_weight", 0.0),
            diagnostics.get("latency_ms", 0.0),
            response.analysis.reasons,
        )
        logger.log(log_level, "Hybrid semantic matches: %s", diagnostics.get("semantic", []))
        logger.log(log_level, "Hybrid keyword matches: %s", diagnostics.get("keyword", []))
        logger.log(log_level, "Hybrid merged ranking: %s", diagnostics.get("merged", []))
        logger.log(log_level, "Hybrid retrieval reranked output: %s", diagnostics.get("reranked", []))
