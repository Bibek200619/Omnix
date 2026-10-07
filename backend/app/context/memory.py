from __future__ import annotations

import logging
from typing import List, Optional

from .schemas import ContextPayload, Citation, ContextSourceType
from ..services import supabase_service
from ..services.workspace_access_service import require_workspace_access

logger = logging.getLogger(__name__)


class MemoryManager:
    """
    Manages short-term, long-term, and synthesized workspace memory.
    Implements the Organizational Memory Engine for Omnix.
    """

    async def fetch_memory(
        self, payload: ContextPayload, limit: int = 6
    ) -> List[Citation]:
        """Fetch memory context for the given payload."""
        if payload.workspace_id:
            await require_workspace_access(payload.workspace_id, payload.user_id)
        citations = []

        # 1. Synthesized Workspace Memory (High Priority)
        if payload.workspace_id:
            synth_cites = await self._fetch_synthesized_memory(payload.workspace_id)
            citations.extend(synth_cites)

        # 2. Immediate Conversation History
        if payload.conversation_id:
            conv_citations = await self._fetch_conversation_memory(
                payload.conversation_id, payload.user_id, payload.workspace_id, limit
            )
            citations.extend(conv_citations)
            
        # 3. Recent Conversations Context
        recent_convs = await self._fetch_recent_conversations(
            payload.user_id, payload.workspace_id, limit=3
        )
        citations.extend(recent_convs)
        
        return citations

    async def _fetch_synthesized_memory(self, workspace_id: str) -> List[Citation]:
        """Fetch synthesized organizational memory summaries."""
        try:
            # Fetch the most important/recent synthesis for this workspace
            rows = await supabase_service.select_all_trusted(
                "workspace_intelligence_memory",
                "id,content,memory_type,importance_score,structured_data",
                filters={"workspace_id": workspace_id},
                order_by="importance_score",
                desc=True,
                limit=3
            )
            
            citations = []
            for row in rows:
                citations.append(
                    Citation(
                        source_id=f"synth_{row.get('id')}",
                        source_type=ContextSourceType.MEMORY,
                        content=f"Synthesized Workspace Memory ({row.get('memory_type')}): {row.get('content')}",
                        metadata=row.get("structured_data") or {},
                        score=row.get("importance_score", 0.7)
                    )
                )
            return citations
        except Exception:
            raise RuntimeError("Synthesized workspace memory is unavailable.") from None

    async def _fetch_conversation_memory(
        self,
        conversation_id: str,
        user_id: str,
        workspace_id: Optional[str],
        limit: int,
    ) -> List[Citation]:
        try:
            conversation_filters = {"id": conversation_id}
            if workspace_id:
                conversation_filters["workspace_id"] = workspace_id
            else:
                conversation_filters.update(
                    {"user_id": user_id, "workspace_id": {"is": None}}
                )
            conversation = await supabase_service.select_one_trusted(
                "conversations", "id", filters=conversation_filters
            )
            if conversation is None:
                raise RuntimeError("Conversation is outside the memory scope.")

            filters = {"conversation_id": conversation_id}
            if not workspace_id:
                filters["user_id"] = user_id

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
                        metadata={
                            "role": msg.get("role"),
                            "created_at": msg.get("created_at"),
                        },
                        score=0.9,  # Direct history is very relevant
                    )
                )
            return citations
        except Exception:
            raise RuntimeError("Conversation memory is unavailable.") from None

    async def _fetch_recent_conversations(
        self, user_id: str, workspace_id: Optional[str], limit: int
    ) -> List[Citation]:
        try:
            filters = (
                {"workspace_id": workspace_id}
                if workspace_id
                else {"user_id": user_id, "workspace_id": {"is": None}}
            )

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
                        content=f"Recent Conversation Summary: {c.get('title') or 'Omnix'}",
                        score=0.6,
                    )
                )
            return citations
        except Exception:
            raise RuntimeError("Recent conversation memory is unavailable.") from None
