from __future__ import annotations

import logging
from typing import Any, List

from ..db.supabase_client import get_supabase
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
    embedding = await embed_query(query)
    if not embedding:
        return []

    supabase = get_supabase()
    try:
        params = {
            "q": embedding,
            "p_top_k": top_k,
            "p_user": user_id,
            "p_workspace": workspace_id,
        }
        logger.info("Starting semantic_search RPC (top_k=%d, dimension=%d).", top_k, len(embedding))
        resp = supabase.rpc("search_documents_vector", params).execute()
        rows = getattr(resp, "data", None) or []
        logger.info("semantic_search RPC returned %d row(s).", len(rows))
        return rows
    except Exception:
        logger.exception("Semantic search via pgvector RPC failed.")
        return []
