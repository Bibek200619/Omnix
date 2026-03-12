from __future__ import annotations

from abc import ABC, abstractmethod
import re

from .scoring import QueryAnalysis, RetrievalResult


class Reranker(ABC):
    """Base reranker interface for future cross-encoder, local model, or LLM rerankers."""

    @abstractmethod
    async def rerank(
        self,
        query: str,
        results: list[RetrievalResult],
        *,
        analysis: QueryAnalysis,
    ) -> list[RetrievalResult]:
        pass


class ScoreBasedReranker(Reranker):
    """Lightweight reranker that only uses fused scores and deterministic boosts."""

    async def rerank(
        self,
        query: str,
        results: list[RetrievalResult],
        *,
        analysis: QueryAnalysis,
    ) -> list[RetrievalResult]:
        normalized_query = analysis.normalized_query
        terms = [token.lower() for token in analysis.tokens if len(token) > 1]

        reranked: list[RetrievalResult] = []
        for position, result in enumerate(results):
            candidate = result.clone()
            content = (candidate.content or "").lower()
            file_name = (candidate.file_name or "").lower()
            score = candidate.score

            if "semantic" in candidate.sources and "keyword" in candidate.sources:
                score += 0.05

            if analysis.is_exact and normalized_query:
                if normalized_query in content:
                    score += 0.12
                if normalized_query in file_name:
                    score += 0.18

            if analysis.is_filename_lookup and file_name:
                filename_hits = sum(1 for term in terms if term in file_name)
                if filename_hits:
                    score += min(0.2, 0.06 * filename_hits)

            if analysis.is_technical and terms:
                technical_hits = sum(1 for term in terms if _is_technical(term) and (term in content or term in file_name))
                if technical_hits:
                    score += min(0.16, 0.05 * technical_hits)

            candidate.rerank_score = score
            candidate.diagnostics["pre_rerank_position"] = position
            candidate.diagnostics["score_based_rerank"] = score
            reranked.append(candidate)

        reranked.sort(
            key=lambda item: (
                item.rerank_score if item.rerank_score is not None else item.score,
                item.score,
                item.keyword_score,
                item.semantic_score,
            ),
            reverse=True,
        )
        return reranked


def _is_technical(term: str) -> bool:
    return bool(re.search(r"\d|[_:/#.-]", term))
