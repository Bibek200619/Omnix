from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple
from functools import lru_cache
from time import time

from ..rag.retrieval import RAGRetriever
from ..rag.context_builder import ContextBuilder
from ..rag.startup import get_vector_store
from ..services import workspace_service
from ..services import supabase_service
from ..services import chat_service

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
        self.retriever = RAGRetriever(self.vector_store)
        self.max_chunks = max_chunks
        self.cache = SimpleTTLCache(ttl=cache_ttl)
        # small convenience builder for prompt formatting
        self.context_builder = ContextBuilder(max_chunks=max_chunks)

    async def retrieve_chunks(self, query: str, user_id: str, workspace_id: str | None = None, top_k: int = 8):
        # use retriever directly
        return await self.retriever.retrieve(query, user_id, workspace_id, top_k=top_k)

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

        # 4) retrieval chunks for query
        retrieved = await self.retrieve_chunks(query, user_id, workspace_id, top_k=self.max_chunks * 2)

        # prioritize: artifacts (recent), retrieved by score, convs, ws summary
        chunks_texts: List[str] = []
        sources: List[dict[str, Any]] = []

        # include artifact content first
        for art in artifacts:
            content = art.get("content")
            if content:
                chunks_texts.append(content)
                sources.append({"type": "artifact", "id": art.get("id"), "title": art.get("title")})
                if len(chunks_texts) >= self.max_chunks:
                    break

        # then top retrieved unique chunks
        for r in retrieved:
            if len(chunks_texts) >= self.max_chunks:
                break
            content = r.get("content")
            if not content:
                continue
            if content in chunks_texts:
                continue
            chunks_texts.append(content)
            sources.append({"type": "retrieval", "chunk_id": r.get("chunk_id"), "file_name": r.get("file_name")})

        # if still under limit, add convs
        for c in convs:
            if len(chunks_texts) >= self.max_chunks:
                break
            chunks_texts.append(str(c))
            sources.append({"type": "conversation_snippet"})

        prompt = self.context_builder.build_context(query, chunks_texts)

        return {"prompt": prompt, "sources": sources, "chunks": chunks_texts}
