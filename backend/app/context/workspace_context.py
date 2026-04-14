from __future__ import annotations

import logging
from typing import List, Optional

from .schemas import ContextPayload, Citation, ContextSourceType
from ..services import workspace_service, supabase_service

logger = logging.getLogger(__name__)


class WorkspaceContextManager:
    """Workspace intelligence layer."""

    async def fetch_workspace_context(self, payload: ContextPayload) -> List[Citation]:
        citations = []
        
        # 1. Workspace Summary
        if payload.workspace_id:
            try:
                ws = await workspace_service._enriched_workspace_for_user(
                    payload.workspace_id, payload.user_id
                )
                citations.append(
                    Citation(
                        source_id=f"ws_{payload.workspace_id}",
                        source_type=ContextSourceType.WORKSPACE,
                        content=f"Workspace Context: {ws}",
                    )
                )
            except Exception:
                logger.exception("Failed to fetch workspace summary.")
                
        # 2. Top shared artifacts
        try:
            filters = {"workspace_id": payload.workspace_id} if payload.workspace_id else {"user_id": payload.user_id}
            rows = await supabase_service.select_all_trusted(
                "artifacts",
                "id,title,type,content,metadata",
                filters=filters,
                order_by="created_at",
                desc=True,
                limit=3,
            )
            for row in rows:
                content = row.get("content")
                if content:
                    citations.append(
                        Citation(
                            source_id=str(row.get("id")),
                            source_type=ContextSourceType.WORKSPACE,
                            content=f"Artifact ({row.get("title", "Omnix")}): {content[:500]}",
                            metadata=row.get("metadata") or {},
                        )
                    )
        except Exception:
            logger.exception("Failed to fetch artifacts for context.")

        return citations
