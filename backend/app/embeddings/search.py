from __future__ import annotations

import logging
from typing import Any, List

from ..db.supabase import get_supabase
from .provider import get_default_provider

logger = logging.getLogger(__name__)


async def embed_query(text: str) -> List[float]:
    provider = get_default_provider()
    return await provider.embed_text(text)


async def semantic_search(query: str, user_id: str, workspace_id: str | None = None, top_k: int = 5) -> List[dict[str, Any]]:
    """Embed the query and perform pgvector RPC search. Returns list of rows.

    Each row includes id, content, similarity (0..1).
    """
    embedding = await embed_query(query)
    if not embedding:
        return []

    supabase = get_supabase()
    try:
        params = {
            "query_embedding": embedding,
            "match_threshold": 0.0,
            "match_count": top_k,
            "filter_user_id": user_id,
        }
        # Some migrations provide workspace filtering; include if supported (RPC will ignore unknown keys)
        if workspace_id is not None:
            params["filter_workspace_id"] = workspace_id
        resp = supabase.rpc("match_documents", params).execute()
        rows = getattr(resp, "data", None) or []
        return rows
    except Exception:
        logger.exception("Semantic search via pgvector RPC failed.")
        return []
