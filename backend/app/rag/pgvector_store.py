from __future__ import annotations

import logging
import math
from typing import Any

from ..core.config import get_settings
from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embedding_dimension
from ..db.supabase_client import get_supabase
from ..services.supabase_service import execute_query_sync
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)


EMBEDDING_DIMENSION = get_expected_embedding_dimension()


class PgVectorStore(VectorStore):
    """
    pgvector-based implementation of VectorStore using Supabase.
    """
    supports_distance_threshold = True

    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str], workspace_ids: list[str] | None = None) -> None:
        # Embeddings are now inserted directly via the ingestion pipeline.
        # This method is retained for interface compatibility.
        pass

    def search(
        self, 
        query_embedding: list[float], 
        user_id: str, 
        workspace_id: str | list[str] | None = None, 
        top_k: int = 3,
        *,
        distance_threshold: float | None = None,
    ) -> list[tuple[str, float]]:
        if not query_embedding:
            return []

        validate_embedding_dimension(query_embedding, expected_dim=EMBEDDING_DIMENSION, label="query embedding")

        supabase = get_supabase()
        try:
            workspace_ids = _normalize_workspace_ids(workspace_id)
            if distance_threshold is None:
                distance_threshold = get_settings().SIMILARITY_THRESHOLD
            match_threshold = _distance_threshold_to_match_threshold(distance_threshold)

            logger.info(
                "Starting pgvector match_documents search (top_k=%d, user_id=%s, workspace_ids=%s).",
                top_k,
                user_id,
                workspace_ids,
            )
            response = execute_query_sync(
                supabase.rpc(
                    "match_documents",
                    {
                        "query_embedding": query_embedding,
                        "match_threshold": match_threshold,
                        "match_count": top_k,
                        "filter_user_id": user_id,
                        "filter_workspace_ids": workspace_ids,
                    },
                ),
                operation="pgvector semantic search",
            )

            data = getattr(response, "data", None) or []
            results = []
            for row in data:
                distance = _row_distance(row)
                results.append((str(row["id"]), distance))
            logger.info("pgvector match_documents search completed with %d result(s).", len(results))
            return results
        except Exception:
            logger.exception(
                "pgvector search failed. Ensure match_documents accepts %d-dimensional local embeddings.",
                EMBEDDING_DIMENSION,
            )
            return []


def _normalize_workspace_ids(workspace_id: str | list[str] | None) -> list[str] | None:
    if workspace_id is None:
        return None
    if isinstance(workspace_id, list):
        return [str(value) for value in workspace_id if value]
    return [str(workspace_id)]


def _distance_threshold_to_match_threshold(distance_threshold: float | None) -> float:
    if distance_threshold is None:
        return -1.0
    try:
        threshold = 1.0 - float(distance_threshold)
    except Exception:
        return -1.0
    if not math.isfinite(threshold):
        return -1.0
    return max(-1.0, min(1.0, threshold))


def _row_distance(row: dict[str, Any]) -> float:
    if row.get("distance") is not None:
        return float(row["distance"])
    if row.get("similarity") is None:
        return 0.0
    similarity = float(row["similarity"])
    if not math.isfinite(similarity):
        return 0.0
    return max(0.0, 1.0 - similarity)
