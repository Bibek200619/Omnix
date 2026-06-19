from typing import Dict, List, Any, Optional
from datetime import datetime
from .schemas import GraphSnapshot, NodeState, EdgeState

class ExecutionGraph:
    """Models the execution flow as a Directed Acyclic Graph."""
    
    def __init__(self):
        self._nodes: Dict[str, NodeState] = {}
        self._edges: List[EdgeState] = []

    def add_node(self, node_id: str, node_type: str, metadata: Optional[Dict[str, Any]] = None):
        self._nodes[node_id] = NodeState(
            node_id=node_id,
            node_type=node_type,
            status="pending",
            metadata=metadata or {}
        )

    def update_node_status(self, node_id: str, status: str, error: Optional[str] = None):
        if node_id in self._nodes:
            node = self._nodes[node_id]
            node.status = status
            if status == "running" and not node.started_at:
                node.started_at = datetime.utcnow()
            elif status in ["completed", "failed"]:
                node.completed_at = datetime.utcnow()
            
            if error:
                node.error = error

    def add_edge(self, source_id: str, target_id: str, metadata: Optional[Dict[str, Any]] = None):
        self._edges.append(EdgeState(
            source_id=source_id,
            target_id=target_id,
            metadata=metadata or {}
        ))

    def get_snapshot(self) -> GraphSnapshot:
        return GraphSnapshot(
            nodes=self._nodes,
            edges=self._edges
        )
