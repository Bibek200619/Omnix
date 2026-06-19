from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


WorkspaceSearchResultType = Literal["conversation", "task", "initiative", "decision"]


class WorkspaceSearchResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    type: WorkspaceSearchResultType
    title: str
    preview: str | None = None
    context: str | None = None
    url: str
    channel_id: str | None = None
    message_id: str | None = None
    matched_field: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WorkspaceSearchResponse(BaseModel):
    conversations: list[WorkspaceSearchResult]
    tasks: list[WorkspaceSearchResult]
    initiatives: list[WorkspaceSearchResult]
    decisions: list[WorkspaceSearchResult]
