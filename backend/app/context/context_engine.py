from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple
from time import time

from ..rag.startup import get_vector_store
from ..retrieval.context_builder import ContextBuilder, ContextSupplement
from ..retrieval.hybrid_search import HybridSearchEngine
from ..services import workspace_service
from ..services import supabase_service

logger = logging.getLogger(__name__)


class SimpleTTLCache:
    def __init__(self, ttl: int = 30):
        self.ttl = ttl
        self._store: Dict[str, Tuple[float, Any]] = {}

    def get(self, key: str):
        entry = self._store.get(key)
        if not entry:
            return None
        ts, val = entry
        if time() - ts > self.ttl:
            del self._store[key]
            return None
        return val

    def set(self, key: str, val: Any):
        self._store[key] = (time(), val)


class ContextEngine:
    """Unified context assembler.

    Combines workspace metadata, recent conversations, top artifacts, and
    RAG-retrieved chunks into a prioritized context payload for prompts.
    """

    def __init__(self, vector_store=None, max_chunks: int = 6, cache_ttl: int = 30):
        self.vector_store = vector_store or get_vector_store()
        self.retrieval_engine = HybridSearchEngine(self.vector_store)
        self.max_chunks = max_chunks
        self.cache = SimpleTTLCache(ttl=cache_ttl)
        self.context_builder = ContextBuilder(max_chunks=max_chunks)

    async def retrieve_chunks(self, query: str, user_id: str, workspace_id: str | None = None, top_k: int = 8):
        response = await self.retrieval_engine.search(query, user_id=user_id, workspace_id=workspace_id, top_k=top_k)
        return [result.to_dict() for result in response.results]

    async def workspace_summary(self, user_id: str, workspace_id: str | None = None) -> str:
        cache_key = f"ws_summary:{workspace_id}:{user_id}"
        cached = self.cache.get(cache_key)
        if cached:
            return cached

        # best-effort summary: use workspace_service for metadata
        try:
            if workspace_id:
                ws = await workspace_service._enriched_workspace_for_user(workspace_id, user_id)
            else:
                # user's personal workspace overview (counts)
                workspaces = await workspace_service.list_user_workspaces(user_id)
                ws = {"count": len(workspaces)}
        except Exception:
            logger.exception("Failed to fetch workspace summary")
            ws = {"count": 0}

        text = f"Workspace: {workspace_id or 'personal'} summary: {ws}"
        self.cache.set(cache_key, text)
        return text

    async def recent_conversation_context(self, user_id: str, workspace_id: str | None = None, limit: int = 6) -> List[str]:
        cache_key = f"recent_conv:{workspace_id}:{user_id}:{limit}"
        cached = self.cache.get(cache_key)
        if cached:
            return cached

        try:
            # Fetch recent conversations + last messages using existing service helpers
            if workspace_id:
                convs = await supabase_service.select_all_trusted(
                    "conversations",
                    "id,title,last_message_at,created_at",
                    filters={"workspace_id": workspace_id},
                    order_by="last_message_at",
                    desc=True,
                    limit=limit,
                )
            else:
                convs = await supabase_service.select_all(
                    "conversations",
                    "id,title,last_message_at,created_at",
                    filters={"user_id": user_id},
                    order_by="last_message_at",
                    desc=True,
                    limit=limit,
                )
        except Exception:
            logger.exception("Failed to fetch recent conversations")
            convs = []

        snippets = []
        for c in convs:
            title = c.get("title") or "Conversation"
            snippets.append(f"Conversation: {title}")

        self.cache.set(cache_key, snippets)
        return snippets

    async def top_artifacts(self, user_id: str, workspace_id: str | None = None, limit: int = 5) -> List[dict[str, Any]]:
        cache_key = f"artifacts:{workspace_id}:{user_id}:{limit}"
        cached = self.cache.get(cache_key)
        if cached:
            return cached

        try:
            if workspace_id:
                rows = await supabase_service.select_all_trusted(
                    "artifacts",
                    "id,title,type,content,created_at,updated_at,metadata",
                    filters={"workspace_id": workspace_id},
                    order_by="created_at",
                    desc=True,
                    limit=limit,
                )
            else:
                rows = await supabase_service.select_all_trusted(
                    "artifacts",
                    "id,title,type,content,created_at,updated_at,metadata",
                    filters={"user_id": user_id},
                    order_by="created_at",
                    desc=True,
                    limit=limit,
                )
        except Exception:
            logger.exception("Failed to fetch artifacts for context")
            rows = []

        self.cache.set(cache_key, rows)
        return rows

    async def assemble(self, query: str, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
        """Return assembled context payload with prioritized sections and metadata.

        Returns dict with keys: 'prompt' (string), 'sources' (list), 'chunks' (list)
        """
        # 1) workspace summary
        ws = await self.workspace_summary(user_id, workspace_id)

        # 2) recent conv snippets
        convs = await self.recent_conversation_context(user_id, workspace_id, limit=4)

        # 3) top artifacts
        artifacts = await self.top_artifacts(user_id, workspace_id, limit=4)

        # 4) hybrid retrieval chunks for query
        retrieval_response = await self.retrieval_engine.search(
            query,
            user_id=user_id,
            workspace_id=workspace_id,
            top_k=self.max_chunks * 2,
        )

        supplements: list[ContextSupplement] = [
            ContextSupplement(
                content=ws,
                title="Workspace Summary",
                source_type="workspace_summary",
                source_id=workspace_id,
                workspace_id=workspace_id,
                score=0.05,
            )
        ]

        for art in artifacts:
            content = art.get("content")
            if content:
                supplements.append(
                    ContextSupplement(
                        content=content,
                        title=art.get("title") or "Artifact",
                        source_type="artifact",
                        source_id=str(art.get("id")) if art.get("id") else None,
                        workspace_id=workspace_id,
                        score=0.35,
                        metadata=art.get("metadata") or {},
                    )
                )

        for c in convs:
            supplements.append(
                ContextSupplement(
                    content=str(c),
                    title="Recent Conversation",
                    source_type="conversation_snippet",
                    workspace_id=workspace_id,
                    score=0.1,
                )
            )

        built_context = self.context_builder.build(
            query,
            retrieval_response.results,
            workspace_id=workspace_id,
            supplemental_contexts=supplements,
        )

        return {
            "prompt": built_context.prompt,
            "sources": built_context.sources,
            "chunks": [chunk.get("content", "") for chunk in built_context.chunks],
            "retrieval": retrieval_response.to_dict(),
            "diagnostics": built_context.diagnostics,
        }
