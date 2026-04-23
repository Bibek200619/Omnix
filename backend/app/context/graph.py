from __future__ import annotations

import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field

from .schemas import Citation, ContextSourceType
from ..services import workspace_service, supabase_service

logger = logging.getLogger(__name__)

@dataclass
class GraphNode:
    id: str
    type: str
    data: Dict[str, Any]
    connections: List[str] = field(default_factory=list)

class WorkspaceIntelligenceGraph:
    """
    Orchestrates the organizational intelligence graph for Omnix.
    Maps relationships between workspaces, members, artifacts, and synthesized memory.
    """

    async def get_workspace_node(self, workspace_id: str, user_id: str) -> Optional[GraphNode]:
        try:
            ws = await workspace_service._enriched_workspace_for_user(workspace_id, user_id)
            return GraphNode(
                id=workspace_id,
                type="workspace",
                data=ws,
                connections=[str(ws.get("parent_workspace_id"))] if ws.get("parent_workspace_id") else []
            )
        except Exception:
            logger.exception(f"Failed to fetch workspace node: {workspace_id}")
            return None

    async def get_related_nodes(self, workspace_id: str, depth: int = 1) -> List[GraphNode]:
        """
        Future: Navigate the graph to find related intelligence nodes 
        (e.g., parent workspace context, sibling subspaces).
        """
        # Placeholder for complex graph traversal
        return []

    def build_graph_citation(self, node: GraphNode) -> Citation:
        return Citation(
            source_id=f"graph_{node.type}_{node.id}",
            source_type=ContextSourceType.WORKSPACE,
            content=f"INTELLIGENCE NODE ({node.type}): {node.data}",
            metadata=node.data,
            score=0.9
        )

workspace_graph = WorkspaceIntelligenceGraph()
