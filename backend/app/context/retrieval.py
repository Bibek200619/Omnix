from __future__ import annotations

import logging
from typing import List, Optional

from .schemas import ContextPayload, Citation, ContextSourceType
from ..rag.startup import get_vector_store
from ..retrieval.hybrid_search import HybridSearchEngine
from ..retrieval.router import intelligence_router

logger = logging.getLogger(__name__)


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
    ) -> List[Citation]:
        """Orchestrate retrieval across federated workspace scopes."""
        if not payload.query or not payload.query.strip():
            logger.warning("Empty query provided to RetrievalManager.")
            return []

        try:
            # 1. Determine optimal retrieval scope via Intelligence Router
            routing = await intelligence_router.route_query(payload)
            scope_ids = routing.get("scope_ids", [])
            
            # 2. Execute hybrid search across the determined scope
            response = await self.hybrid_engine.search(
                payload.query,
                user_id=payload.user_id,
                workspace_id=scope_ids, # Passing list for federated search
                top_k=top_k,
            )
            
            citations = []
            for res in response.results:
                citations.append(
                    Citation(
                        source_id=res.chunk_id,
                        source_type=ContextSourceType.RETRIEVAL,
                        content=res.content,
                        file_id=res.file_id,
                        file_name=res.file_name or "Unknown File",
                        metadata={
                            **(res.metadata or {}),
                            "routing": routing # Include routing diagnostics
                        },
                        score=res.score,
                    )
                )
            return citations
        except Exception:
            logger.exception("RetrievalManager failed during federated search.")
            return []
