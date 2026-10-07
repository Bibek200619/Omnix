from __future__ import annotations

import logging
from typing import List

from .schemas import ContextPayload, Citation, ContextSourceType
from ..services import supabase_service, workspace_intelligence_service

logger = logging.getLogger(__name__)


class WorkspaceContextManager:
    """
    Unified Workspace Intelligence Layer.
    Orchestrates workspace profile, specialization, and source awareness.
    """

    async def fetch_workspace_context(self, payload: ContextPayload) -> List[Citation]:
        citations = []
        profile = None
        
        if not payload.workspace_id:
            return citations

        # 1. High-Fidelity Workspace Intelligence Profile
        try:
            profile = await workspace_intelligence_service.build_workspace_intelligence_profile(
                payload.workspace_id, payload.user_id
            )
            
            # Convert profile to a structured system prompt fragment
            intelligence_context = workspace_intelligence_service.workspace_intelligence_system_prompt(
                profile,
                include_focus=False,
            )
            
            citations.append(
                Citation(
                    source_id=f"ws_profile_{payload.workspace_id}",
                    source_type=ContextSourceType.WORKSPACE,
                    content=intelligence_context,
                    score=1.0 # Intelligence profile is foundational
                )
            )
            
            # 2. Workspace Atmosphere / Recent Insights
            insights = profile.get("recent_insights", [])
            if insights:
                citations.append(
                    Citation(
                        source_id=f"ws_insights_{payload.workspace_id}",
                        source_type=ContextSourceType.WORKSPACE,
                        content=f"Current Workspace Atmosphere: {' '.join(insights)}",
                        score=0.9
                    )
                )

        except Exception:
            raise RuntimeError(
                "Workspace intelligence context is unavailable."
            ) from None
                
        # 3. Top contextual artifacts
        try:
            # We look for artifacts in the same scope as the intelligence profile
            scope_ids = [payload.workspace_id]
            if profile and profile.get("scope_workspace_ids"):
                scope_ids = profile["scope_workspace_ids"]

            rows = await supabase_service.select_all_trusted(
                "artifacts",
                "id,title,type,content,metadata",
                filters={"workspace_id": scope_ids},
                order_by="created_at",
                desc=True,
                limit=5,
            )
            for row in rows:
                content = row.get("content")
                if content:
                    citations.append(
                        Citation(
                            source_id=str(row.get("id")),
                            source_type=ContextSourceType.WORKSPACE,
                            content=f"Artifact ({row.get('title', 'Omnix')}): {content[:800]}",
                            metadata=row.get("metadata") or {},
                            score=0.8
                        )
                    )
        except Exception:
            raise RuntimeError("Workspace artifact context is unavailable.") from None

        return citations
