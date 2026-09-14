from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .workspace_mentions import WorkspaceMentionInput, WorkspaceMentionMetadata


ChannelVisibility = Literal["workspace", "private", "project"]
ChannelType = Literal["operational", "announcement"]
PostingPolicy = Literal["members", "leaders"]
AssistanceMode = Literal["summary", "decisions", "actions", "blockers"]
ContextEntityType = Literal["file", "ai_session", "decision", "task", "initiative", "memory"]


class ExecutionContextLink(BaseModel):
    entity_type: ContextEntityType
    entity_id: str = Field(..., min_length=1, max_length=120)
    label: str | None = Field(default=None, max_length=160)


class WorkspaceChannelCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    purpose: str | None = Field(default=None, max_length=280)
    channel_type: ChannelType = "operational"
    visibility: Literal["workspace"] = "workspace"
    posting_policy: PostingPolicy = "members"


class WorkspaceChannelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    created_by: str | None = None
    name: str
    slug: str
    purpose: str | None = None
    channel_type: ChannelType = "operational"
    visibility: ChannelVisibility = "workspace"
    posting_policy: PostingPolicy = "members"
    is_archived: bool = False
    message_count: int = 0
    last_message_preview: str | None = None
    last_message_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WorkspaceChannelMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=6000)
    parent_message_id: str | None = None
    client_nonce: str | None = Field(default=None, max_length=100)
    context_links: list[ExecutionContextLink] = Field(default_factory=list, max_length=12)
    mentions: list[WorkspaceMentionInput] = Field(default_factory=list, max_length=50)


class WorkspaceConversationAuthorIdentity(BaseModel):
    role_label: str | None = None
    operational_label: str | None = None
    display_label: str | None = None


class WorkspaceChannelMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    channel_id: str
    author_user_id: str
    parent_message_id: str | None = None
    content: str
    context_links: list[ExecutionContextLink] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    mentions: list[WorkspaceMentionMetadata] = Field(default_factory=list)
    client_nonce: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    edited_at: datetime | None = None
    author_name: str | None = None
    author_email: str | None = None
    author_avatar_url: str | None = None
    author_avatar_label: str = "U"
    author_identity: WorkspaceConversationAuthorIdentity | None = None
    thread_reply_count: int = 0


class WorkspaceConversationAssistanceRequest(BaseModel):
    mode: AssistanceMode
    thread_root_id: str | None = None


class WorkspaceConversationAssistanceRead(BaseModel):
    mode: AssistanceMode
    content: str
    source_message_count: int
    generated_at: datetime
