from __future__ import annotations

import logging
from typing import List, Dict, Any

from ..services import workspace_intelligence_service, workspace_service
from ..context.schemas import ContextPayload

logger = logging.getLogger(__name__)

class IntelligenceRouter:
    """
    Directs retrieval and context gathering across the organizational hierarchy.
    Ensures data isolation while enabling authorized cross-workspace intelligence discovery.
    """

    async def determine_retrieval_scope(self, payload: ContextPayload) -> List[str]:
        """
        Calculates the effective list of workspace IDs that should be searched 
        for a given query, based on user permissions and workspace hierarchy.
        """
        if not payload.workspace_id:
            # Fallback to user-owned workspaces if no active workspace
            try:
                workspaces = await workspace_service.list_user_workspaces(payload.user_id)
                return [str(w["id"]) for w in workspaces if w.get("id")]
            except Exception:
                logger.exception("Failed to determine global retrieval scope")
                return []

        try:
            # Fetch the workspace to check its intelligence preferences
            access = await workspace_service.require_workspace_access(payload.workspace_id, payload.user_id)
            workspace = access.workspace
            
            # Use the established service logic for hierarchy-aware scoping
            return await workspace_intelligence_service.workspace_retrieval_scope_ids(
                workspace, payload.user_id
            )
        except Exception:
            logger.exception(f"Failed to route intelligence for workspace: {payload.workspace_id}")
            return [payload.workspace_id]

    async def route_query(self, payload: ContextPayload) -> Dict[str, Any]:
        """
        Routes the query to specific intelligence nodes in the graph.
        Future: Use LLM to decide which workspaces are most relevant to avoid noise.
        """
        scope_ids = await self.determine_retrieval_scope(payload)
        
        return {
            "scope_ids": scope_ids,
            "routing_strategy": "hierarchy_aware",
            "is_federated": len(scope_ids) > 1
        }

intelligence_router = IntelligenceRouter()
