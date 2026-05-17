from __future__ import annotations

import logging

from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embedding_dimension, validate_embeddings_dimension
from ..db.supabase_client import get_supabase
from ..services.supabase_service import execute_query_sync
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)


EMBEDDING_DIMENSION = get_expected_embedding_dimension()


class PgVectorStore(VectorStore):
    """
    pgvector-based implementation of VectorStore using Supabase.
    """

    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str], workspace_ids: list[str] | None = None) -> None:
        # Embeddings are now inserted directly via the ingestion pipeline.
        # This method is retained for interface compatibility.
        pass

    def search(self, query_embedding: list[float], user_id: str, workspace_id: str | None = None, top_k: int = 3) -> list[tuple[str, float]]:
        if not query_embedding:
            return []

        validate_embedding_dimension(query_embedding, expected_dim=EMBEDDING_DIMENSION, label="query embedding")

        supabase = get_supabase()
        try:
            logger.info(
                "Starting pgvector semantic search (top_k=%d, user_id=%s, workspace_id=%s, dimension=%d).",
                top_k,
                user_id,
                workspace_id,
                EMBEDDING_DIMENSION,
            )
            response = execute_query_sync(
                supabase.rpc(
                    "search_documents_vector",
                    {
                        "q": query_embedding,
                        "p_top_k": top_k,
                        "p_user": user_id,
                        "p_workspace": workspace_id,
                    },
                ),
                operation="pgvector semantic search",
            )

            data = getattr(response, "data", None) or []
            results = []
            for row in data:
                distance = float(row.get("distance", 0.0))
                results.append((str(row["id"]), distance))
            logger.info("pgvector semantic search completed with %d result(s).", len(results))
            return results
        except Exception as exc:
            logger.exception(
                "pgvector search failed. Ensure search_documents_vector accepts %d-dimensional local embeddings.",
                EMBEDDING_DIMENSION,
            )
            return []
