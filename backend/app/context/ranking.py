from __future__ import annotations

import logging
from typing import List

from .schemas import Citation

logger = logging.getLogger(__name__)


class RankingEngine:
    """Ranking engine for prioritizing retrieved context and memory."""

    def rank(self, citations: List[Citation]) -> List[Citation]:
        """Rank citations based on score and source type priorities."""
        # Base implementation: Sort purely by the assigned score.
        # Future: implement cross-encoder reranking.
        citations.sort(key=lambda c: c.score, reverse=True)
        return citations
