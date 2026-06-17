from __future__ import annotations

import logging
import math
from typing import Any, List

from ..db.supabase_client import get_supabase
from ..services.supabase_service import execute_query_sync
from .dimensions import get_expected_embedding_dimension, validate_embedding_dimension
from .provider import get_default_provider

logger = logging.getLogger(__name__)


async def embed_query(text: str) -> List[float]:
    provider = get_default_provider()
    embedding = await provider.embed_text(text)
    validate_embedding_dimension(
        embedding,
        expected_dim=get_expected_embedding_dimension(),
        label="query embedding",
    )
    return embedding


async def semantic_search(query: str, user_id: str, workspace_id: str | None = None, top_k: int = 3) -> List[dict[str, Any]]:
    """Embed the query and perform pgvector RPC search. Returns list of rows.

    Each row includes id, content, similarity (0..1).
    """
    try:
        embedding = await embed_query(query)
    except Exception:
        logger.exception("Semantic query embedding unavailable; returning no semantic matches.")
        return []
    if not embedding:
        return []

    supabase = get_supabase()
    try:
        workspace_ids = [workspace_id] if workspace_id else None
        params = {
            "query_embedding": embedding,
            "match_threshold": -1.0,
            "match_count": top_k,
            "filter_user_id": user_id,
            "filter_workspace_ids": workspace_ids,
        }
        logger.info("Starting semantic_search RPC (top_k=%d, dimension=%d).", top_k, len(embedding))
        resp = execute_query_sync(
            supabase.rpc("match_documents", params),
            operation="semantic search rpc",
        )
        rows = getattr(resp, "data", None) or []
        for row in rows:
            if "distance" not in row and row.get("similarity") is not None:
                try:
                    similarity = float(row["similarity"])
                    row["distance"] = max(0.0, 1.0 - similarity) if math.isfinite(similarity) else 0.0
                except Exception:
                    row["distance"] = 0.0
        logger.info("semantic_search RPC returned %d row(s).", len(rows))
        return rows
    except Exception:
        logger.exception("Semantic search via pgvector RPC failed.")
        return []
