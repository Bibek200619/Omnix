from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


TaskStatus = Literal["idea", "planned", "active", "review", "complete"]
TaskContextType = Literal[
    "conversation_message",
    "channel",
    "ai_session",
    "file",
    "decision",
    "initiative",
    "ai_action_extraction",
]
TaskAssistanceMode = Literal["blockers", "stalled", "next_actions", "workload"]


class TaskContextLink(BaseModel):
    context_type: TaskContextType
    context_id: str = Field(..., min_length=1, max_length=120)
    label: str | None = Field(default=None, max_length=160)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkspaceTaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    status: TaskStatus = "idea"
    owner_user_id: str | None = None
    due_date: date | None = None
    blockers: list[str] = Field(default_factory=list, max_length=12)
    linked_context: list[TaskContextLink] = Field(default_factory=list, max_length=12)
    initiative_id: str | None = None
    client_nonce: str | None = Field(default=None, max_length=100)


class WorkspaceTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    status: TaskStatus | None = None
    owner_user_id: str | None = None
    due_date: date | None = None
    blockers: list[str] | None = Field(default=None, max_length=12)
    linked_context: list[TaskContextLink] | None = Field(default=None, max_length=12)
    initiative_id: str | None = None


class WorkspaceTaskFromMessageCreate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    status: TaskStatus = "idea"
    owner_user_id: str | None = None
    due_date: date | None = None
    client_nonce: str | None = Field(default=None, max_length=100)


class WorkspaceTaskFromAssistanceCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    assistance_text: str = Field(..., min_length=1, max_length=6000)
    thread_root_id: str | None = None
    status: TaskStatus = "idea"
    owner_user_id: str | None = None
    due_date: date | None = None
    client_nonce: str | None = Field(default=None, max_length=100)


class WorkspaceTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    title: str
    description: str | None = None
    status: TaskStatus
    owner_user_id: str | None = None
    created_by: str
    due_date: date | None = None
    blockers: list[str] = Field(default_factory=list)
    linked_context: list[TaskContextLink] = Field(default_factory=list)
    activity_metadata: dict[str, Any] = Field(default_factory=dict)
    momentum_metadata: dict[str, Any] = Field(default_factory=dict)
    initiative_id: str | None = None
    client_nonce: str | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    owner_name: str | None = None
    owner_email: str | None = None
    owner_avatar_label: str | None = None
    creator_name: str | None = None
    linked_decisions: list[dict[str, Any]] = Field(default_factory=list)


class WorkspaceTaskMomentumRead(BaseModel):
    workspace_id: str
    total_count: int
    open_count: int
    complete_count: int
    blocked_count: int
    due_soon_count: int
    overdue_count: int
    unassigned_count: int
    flow_counts: dict[TaskStatus, int]
    completion_ratio: float
    health: Literal["quiet", "moving", "blocked", "complete"]
    summary: str
    calculated_at: datetime


class WorkspaceTaskAssistanceRequest(BaseModel):
    mode: TaskAssistanceMode


class WorkspaceTaskAssistanceRead(BaseModel):
    mode: TaskAssistanceMode
    content: str
    source_task_count: int
    generated_at: datetime
