from __future__ import annotations

import logging
from typing import Any

from ..db.supabase import get_supabase
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)

class PgVectorStore(VectorStore):
    """
    pgvector-based implementation of VectorStore using Supabase.
    """

    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str], workspace_ids: list[str] | None = None) -> None:
        if not embeddings or not ids or not user_ids:
            return

        if len(embeddings) != len(ids) or len(embeddings) != len(user_ids):
            raise ValueError("The number of embeddings must match the number of IDs and user_ids.")

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
            except Exception as exc:
                logger.exception("Failed to update document %s with embedding.", doc_id)
                # non-fatal: continue with remaining
                continue

    def search(self, query_embedding: list[float], user_id: str, top_k: int = 5) -> list[tuple[str, float]]:
        if not query_embedding:
            return []
            
        supabase = get_supabase()
        try:
            response = supabase.rpc("match_documents", {
                "query_embedding": query_embedding,
                "match_threshold": 0.0,
                "match_count": top_k,
                "filter_user_id": user_id
            }).execute()
            
            data = getattr(response, "data", None) or []
            results = []
            for row in data:
                distance = 1.0 - row.get("similarity", 1.0)
                results.append((row["id"], distance))
            return results
        except Exception as exc:
            logger.exception("pgvector search failed.")
            return []

    def save_local(self, index_path: str, map_path: str) -> None:
        pass

    def load_local(self, index_path: str, map_path: str) -> None:
        pass
