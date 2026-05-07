from __future__ import annotations

import logging

from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embedding_dimension, validate_embeddings_dimension
from ..db.supabase import get_supabase
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)


EMBEDDING_DIMENSION = get_expected_embedding_dimension()


class PgVectorStore(VectorStore):
    """
    pgvector-based implementation of VectorStore using Supabase.
    """

    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str], workspace_ids: list[str] | None = None) -> None:
        if not embeddings or not ids or not user_ids:
            return

        if len(embeddings) != len(ids) or len(embeddings) != len(user_ids):
            raise ValueError("The number of embeddings must match the number of IDs and user_ids.")
        if workspace_ids is not None and len(workspace_ids) != len(embeddings):
            raise ValueError("workspace_ids must match the number of embeddings when provided.")

        validate_embeddings_dimension(embeddings, expected_dim=EMBEDDING_DIMENSION, label="pgvector embeddings")

        supabase = get_supabase()

        # Iterate and update each document's embedding. Workspace filtering is optional.
        for idx, (emb, doc_id, user_id) in enumerate(zip(embeddings, ids, user_ids)):
            try:
                query = supabase.table("documents").update({"embedding": emb}).eq("id", doc_id).eq("user_id", user_id)
                # If workspace_ids provided, ensure the document belongs to the workspace
                if workspace_ids:
                    workspace_id = workspace_ids[idx]
                    if workspace_id:
                        query = query.eq("workspace_id", workspace_id)
                query.execute()
            except Exception:
                logger.exception(
                    "Failed to update document %s with local embedding (dimension=%d). "
                    "Check that documents.embedding is vector(%d) and re-run the migration if needed.",
                    doc_id,
                    len(emb),
                    EMBEDDING_DIMENSION,
                )
                raise

    def search(self, query_embedding: list[float], user_id: str, workspace_id: str | None = None, top_k: int = 5) -> list[tuple[str, float]]:
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
            response = supabase.rpc(
                "search_documents_vector",
                {
                    "q": query_embedding,
                    "p_top_k": top_k,
                    "p_user": user_id,
                    "p_workspace": workspace_id,
                },
            ).execute()

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

    def save_local(self, index_path: str, map_path: str) -> None:
        pass

    def load_local(self, index_path: str, map_path: str) -> None:
        pass
