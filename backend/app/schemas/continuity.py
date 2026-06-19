from pydantic import BaseModel, ConfigDict
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID

class WorkspaceOperationalTimelineEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    initiative_id: Optional[UUID] = None
    event_type: str
    summary: str
    metadata: Dict[str, Any]
    created_at: datetime
