from __future__ import annotations

import logging
from typing import List, Optional

from .schemas import ContextPayload, Citation, ContextSourceType
from ..services import supabase_service

logger = logging.getLogger(__name__)


class MemoryManager:
    """Manages short-term, long-term, and workspace memory."""

    async def fetch_memory(self, payload: ContextPayload, limit: int = 6) -> List[Citation]:
        """Fetch memory context for the given payload."""
        citations = []
        if payload.conversation_id:
            conv_citations = await self._fetch_conversation_memory(
                payload.conversation_id, payload.user_id, payload.workspace_id, limit
            )
            citations.extend(conv_citations)
            
        recent_convs = await self._fetch_recent_conversations(
            payload.user_id, payload.workspace_id, limit=3
        )
        citations.extend(recent_convs)
        
        return citations

    async def _fetch_conversation_memory(
        self, conversation_id: str, user_id: str, workspace_id: Optional[str], limit: int
    ) -> List[Citation]:
        try:
            filters = {"conversation_id": conversation_id}
            if workspace_id:
                 pass
            
            messages = await supabase_service.select_all_trusted(
                "messages",
                "id,role,content,created_at",
                filters=filters,
                order_by="created_at",
                desc=True,
                limit=limit,
            )
            
            messages.reverse()
            
            citations = []
            for msg in messages:
                citations.append(
                    Citation(
                        source_id=str(msg.get("id")),
                        source_type=ContextSourceType.MEMORY,
                        content=f"{str(msg.get('role', 'unknown')).upper()}: {msg.get('content')}",
                        metadata={"role": msg.get("role"), "created_at": msg.get("created_at")},
                    )
                )
            return citations
        except Exception:
            logger.exception("Failed to fetch conversation memory.")
            return []
            
    async def _fetch_recent_conversations(
        self, user_id: str, workspace_id: Optional[str], limit: int
    ) -> List[Citation]:
        try:
            filters = {"workspace_id": workspace_id} if workspace_id else {"user_id": user_id}
            
            convs = await supabase_service.select_all_trusted(
                "conversations",
                "id,title,last_message_at",
                filters=filters,
                order_by="last_message_at",
                desc=True,
                limit=limit,
            )
            
            citations = []
            for c in convs:
                citations.append(
                    Citation(
                        source_id=str(c.get("id")),
                        source_type=ContextSourceType.MEMORY,
                        content=f"Recent Conversation: {c.get("title") or "Untitled"}",
                    )
                )
            return citations
        except Exception:
            logger.exception("Failed to fetch recent conversations memory.")
            return []
