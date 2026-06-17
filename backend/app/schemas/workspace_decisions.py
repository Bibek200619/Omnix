from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .workspace_mentions import WorkspaceMentionInput, WorkspaceMentionMetadata


DecisionStatus = Literal["proposed", "accepted", "rejected", "superseded"]
DecisionCandidateSourceType = Literal["conversation", "document"]
DecisionCandidateConfidence = Literal["low", "medium", "high"]
DecisionCandidateMetricAction = Literal["accept", "dismiss"]


class WorkspaceDecisionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    decision_reason: str | None = Field(default=None, max_length=6000)
    status: DecisionStatus = "accepted"
    mentions: list[WorkspaceMentionInput] = Field(default_factory=list, max_length=50)


class WorkspaceDecisionFromMessageCreate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    decision_reason: str | None = Field(default=None, max_length=6000)
    status: DecisionStatus = "accepted"
    mentions: list[WorkspaceMentionInput] = Field(default_factory=list, max_length=50)


class DecisionCandidate(BaseModel):
    id: str
    title: str = Field(..., min_length=1, max_length=180)
    reason: str = Field(..., min_length=1, max_length=1000)
    confidence: DecisionCandidateConfidence
    source_type: DecisionCandidateSourceType
    source_id: str
    supporting_evidence: list[str] = Field(..., min_length=1, max_length=5)


class DecisionCandidateListRead(BaseModel):
    candidates: list[DecisionCandidate] = Field(default_factory=list)
    candidate_count: int
    source_type: DecisionCandidateSourceType
    source_id: str
    generated_at: str


class DecisionCandidateMetricCreate(BaseModel):
    action: DecisionCandidateMetricAction
    candidate_id: str = Field(..., min_length=1, max_length=160)
    source_type: DecisionCandidateSourceType
    source_id: str = Field(..., min_length=1, max_length=160)


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
    initiative_id: str | None = None
    created_by: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    creator_name: str | None = None
    creator_email: str | None = None
    creator_avatar_label: str | None = None
    mentions: list[WorkspaceMentionMetadata] = Field(default_factory=list)

    # Linkage expansion
    linked_tasks: list[dict[str, Any]] = Field(default_factory=list)
    initiative: dict[str, Any] | None = None


class WorkspaceDecisionPageRead(BaseModel):
    items: list[WorkspaceDecisionRead] = Field(default_factory=list)
    next_cursor: str | None = None
    has_more: bool


class WorkspaceDecisionStatusUpdate(BaseModel):
    status: DecisionStatus


class WorkspaceDecisionLinkTask(BaseModel):
    task_id: str


class WorkspaceDecisionLinkInitiative(BaseModel):
    initiative_id: str | None


WorkspaceDecisionRead.model_rebuild()
