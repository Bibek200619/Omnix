from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


WorkspaceSearchResultType = Literal[
    "conversation",
    "task",
    "initiative",
    "decision",
    "file",
    "document",
    "source",
    "member",
    "mention",
    "workspace",
]


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
    conversations: list[WorkspaceSearchResult] = Field(default_factory=list)
    tasks: list[WorkspaceSearchResult] = Field(default_factory=list)
    initiatives: list[WorkspaceSearchResult] = Field(default_factory=list)
    decisions: list[WorkspaceSearchResult] = Field(default_factory=list)
    files: list[WorkspaceSearchResult] = Field(default_factory=list)
    documents: list[WorkspaceSearchResult] = Field(default_factory=list)
    sources: list[WorkspaceSearchResult] = Field(default_factory=list)
    members: list[WorkspaceSearchResult] = Field(default_factory=list)
    mentions: list[WorkspaceSearchResult] = Field(default_factory=list)
    workspaces: list[WorkspaceSearchResult] = Field(default_factory=list)
