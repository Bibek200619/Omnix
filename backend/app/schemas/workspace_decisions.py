from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


DecisionStatus = Literal["proposed", "accepted", "rejected", "superseded"]


class WorkspaceDecisionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    decision_reason: str | None = Field(default=None, max_length=6000)
    status: DecisionStatus = "accepted"


class WorkspaceDecisionFromMessageCreate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    decision_reason: str | None = Field(default=None, max_length=6000)
    status: DecisionStatus = "accepted"


class WorkspaceDecisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    title: str
    description: str | None = None
    decision_reason: str | None = None
    status: DecisionStatus
    source_message_id: str | None = None
    source_channel_id: str | None = None
    created_by: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    creator_name: str | None = None
    creator_email: str | None = None
    creator_avatar_label: str | None = None
