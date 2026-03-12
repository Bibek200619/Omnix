from __future__ import annotations

import logging
from typing import List, Optional

from .schemas import ContextPayload, Citation, ContextSourceType
from ..rag.startup import get_vector_store
from ..retrieval.hybrid_search import HybridSearchEngine

logger = logging.getLogger(__name__)


class RetrievalManager:
    """Centralizes semantic, keyword, and hybrid retrieval operations."""

    def __init__(self, vector_store=None):
        self.vector_store = vector_store or get_vector_store()
        self.hybrid_engine = HybridSearchEngine(self.vector_store)

    async def retrieve(
        self, payload: ContextPayload, top_k: int = 8
    ) -> List[Citation]:
        """Orchestrate retrieval and map to unified Citation objects."""
        if not payload.query or not payload.query.strip():
            logger.warning("Empty query provided to RetrievalManager.")
            return []

        try:
            response = await self.hybrid_engine.search(
                payload.query,
                user_id=payload.user_id,
                workspace_id=payload.workspace_id,
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
                        metadata=res.metadata,
                        score=res.score,
                    )
                )
            return citations
        except Exception as exc:
            logger.exception("RetrievalManager failed during search.")
            return []
