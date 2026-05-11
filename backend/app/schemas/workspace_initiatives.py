from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


InitiativeStatus = Literal["draft", "active", "focused", "at_risk", "complete"]
InitiativeMomentumHealth = Literal["quiet", "active_movement", "blocked_execution", "dormant", "completion_flow"]
InitiativeAssistanceMode = Literal["state", "blockers", "momentum", "decisions"]
ResourceType = Literal["file", "decision", "ai_session", "reference"]


class InitiativeResourceLink(BaseModel):
    resource_type: ResourceType
    resource_id: str = Field(..., min_length=1, max_length=120)
    label: str | None = Field(default=None, max_length=160)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkspaceInitiativeCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    status: InitiativeStatus = "draft"
    owner_user_id: str | None = None
    target_date: date | None = None
    initiative_context: str | None = Field(default=None, max_length=6000)
    linked_resources: list[InitiativeResourceLink] = Field(default_factory=list, max_length=24)
    client_nonce: str | None = Field(default=None, max_length=100)


class WorkspaceInitiativeUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    status: InitiativeStatus | None = None
    owner_user_id: str | None = None
    target_date: date | None = None
    initiative_context: str | None = Field(default=None, max_length=6000)
    linked_resources: list[InitiativeResourceLink] | None = Field(default=None, max_length=24)


class WorkspaceInitiativeChannelAttach(BaseModel):
    channel_id: str = Field(..., min_length=1, max_length=120)


class InitiativeChannelRead(BaseModel):
    id: str
    name: str
    purpose: str | None = None
    message_count: int = 0
    last_message_at: datetime | None = None


class InitiativeMomentumRead(BaseModel):
    health: InitiativeMomentumHealth
    summary: str
    task_count: int
    open_task_count: int
    complete_task_count: int
    blocked_task_count: int
    due_soon_count: int
    overdue_count: int
    channel_count: int
    discussion_message_count: int
    last_movement_at: datetime | None = None


class WorkspaceInitiativeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    title: str
    description: str | None = None
    status: InitiativeStatus
    owner_user_id: str | None = None
    created_by: str | None = None
    target_date: date | None = None
    initiative_context: str | None = None
    linked_resources: list[InitiativeResourceLink] = Field(default_factory=list)
    activity_metadata: dict[str, Any] = Field(default_factory=dict)
    client_nonce: str | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    owner_name: str | None = None
    owner_email: str | None = None
    owner_avatar_label: str | None = None
    creator_name: str | None = None
    linked_tasks: list[dict[str, Any]] = Field(default_factory=list)
    linked_channels: list[InitiativeChannelRead] = Field(default_factory=list)
    momentum: InitiativeMomentumRead


class WorkspaceInitiativeAssistanceRequest(BaseModel):
    mode: InitiativeAssistanceMode


class WorkspaceInitiativeAssistanceRead(BaseModel):
    mode: InitiativeAssistanceMode
    content: str
    source_task_count: int
    source_channel_count: int
    source_message_count: int
    generated_at: datetime
