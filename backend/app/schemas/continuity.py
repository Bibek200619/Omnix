from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID

class WorkspaceInitiativeBase(BaseModel):
    name: str
    description: Optional[str] = None
    status: str = Field(default="active", description="'active', 'paused', or 'completed'")
    momentum_score: float = Field(default=1.0)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class WorkspaceInitiativeCreate(WorkspaceInitiativeBase):
    workspace_id: UUID

class WorkspaceInitiativeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    momentum_score: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None

class WorkspaceInitiativeResponse(WorkspaceInitiativeBase):
    id: UUID
    workspace_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class WorkspaceMomentumSnapshot(BaseModel):
    id: UUID
    workspace_id: UUID
    initiative_id: Optional[UUID] = None
    score: float
    active_collaborators: int
    synthesis_events: int
    unresolved_threads: int
    snapshot_timestamp: datetime
    metadata: Dict[str, Any]

    class Config:
        from_attributes = True

class WorkspaceOperationalTimelineEvent(BaseModel):
    id: UUID
    workspace_id: UUID
    initiative_id: Optional[UUID] = None
    event_type: str
    summary: str
    metadata: Dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True
