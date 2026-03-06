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

    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str]) -> None:
        if not embeddings or not ids or not user_ids:
            return

        if len(embeddings) != len(ids) or len(embeddings) != len(user_ids):
            raise ValueError("The number of embeddings must match the number of IDs and user_ids.")

        supabase = get_supabase()
        
        for emb, doc_id, user_id in zip(embeddings, ids, user_ids):
            try:
                supabase.table("documents").update({"embedding": emb}).eq("id", doc_id).eq("user_id", user_id).execute()
            except Exception as exc:
                logger.exception("Failed to update document %s with embedding.", doc_id)
                pass

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
