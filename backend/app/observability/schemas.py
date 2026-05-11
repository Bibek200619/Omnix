from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
from datetime import datetime
import uuid

class TraceContext(BaseModel):
    trace_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    request_id: Optional[str] = None
    workspace_id: Optional[str] = None
    conversation_id: Optional[str] = None
    session_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class TokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    reserved_completion_tokens: int = 0
    retrieval_tokens: int = 0
    memory_tokens: int = 0
    compression_ratio: float = 1.0

class LatencyMetrics(BaseModel):
    retrieval_ms: float = 0.0
    ranking_ms: float = 0.0
    compression_ms: float = 0.0
    prompt_assembly_ms: float = 0.0
    provider_ms: float = 0.0
    total_ms: float = 0.0

class NodeState(BaseModel):
    node_id: str
    node_type: str
    status: str # "pending", "running", "completed", "failed"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class EdgeState(BaseModel):
    source_id: str
    target_id: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class GraphSnapshot(BaseModel):
    nodes: Dict[str, NodeState] = Field(default_factory=dict)
    edges: List[EdgeState] = Field(default_factory=list)

class ObservabilityEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    trace_context: TraceContext
    payload: Dict[str, Any]
