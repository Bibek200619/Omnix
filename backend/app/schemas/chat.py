from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_INPUT_SIZE = 4000
WorkspaceType = Literal["workspace", "super_workspace", "subworkspace", "global_workspace"]
WorkspaceFocus = Literal["general", "engineering", "design", "research", "strategy"]
WorkspaceRole = Literal["founder", "co_owner", "member", "team_lead", "sub_leader", "sub_member"]
WorkspaceAssignableRole = Literal["co_owner", "member", "team_lead", "sub_leader", "sub_member"]
FileProcessingStatus = Literal[
    "uploaded",
    "queued",
    "extracting",
    "chunking",
    "embedding",
    "ocr_required",
    "ocr_running",
    "searchable",
    "failed",
    "partially_searchable",
]
WorkspaceFocusInput = Literal[
    "general",
    "engineering",
    "design",
    "research",
    "strategy",
    "coding",
    "analytics",
]
WorkspaceAIMode = WorkspaceFocus


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    is_archived: bool | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    workspace_id: str | None = None
    title: str | None = None
    is_archived: bool | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_message_at: datetime | None = None


class ConversationHistoryRead(ConversationRead):
    preview: str | None = None
    latest_message_role: str | None = None
    latest_message_at: datetime | None = None


class MessageCreate(BaseModel):
    conversation_id: str
    content: str = Field(..., min_length=1, max_length=MAX_INPUT_SIZE)
    role: Literal["user", "assistant", "system"] = "user"


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    conversation_id: str
    user_id: str
    role: str
    content: str
    status: Literal["pending", "completed", "failed"] | None = None
    created_at: datetime | None = None
    metadata: dict[str, Any] | None = None
    payload: dict[str, Any] | None = None
    sources: list[dict[str, Any]] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_INPUT_SIZE)
    conversation_id: str | None = None
    attachment_ids: list[str] = Field(default_factory=list, max_length=10)
    search_mode: Literal["auto", "workspace", "web", "hybrid"] = "auto"
    title: str | None = Field(default=None, max_length=255)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    model: str | None = Field(default=None, max_length=120)
    max_tokens: int | None = Field(default=None, ge=1, le=4096)


class ChatResponse(BaseModel):
    conversation_id: str
    user_message_id: str
    assistant_message_id: str
    response: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    conversation: ConversationHistoryRead | None = None
    user_message: MessageRead | None = None
    assistant_message: MessageRead | None = None


class AIMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., min_length=1, max_length=MAX_INPUT_SIZE)


class AIGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=MAX_INPUT_SIZE)
    context: list[AIMessage] = Field(default_factory=list, max_length=40)
    system_prompt: str | None = Field(default=None, max_length=4000)
    model: str | None = Field(default=None, max_length=120)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=4096)


class AIGenerationResponse(BaseModel):
    response: str
    model: str
    provider: Literal["ollama", "openai", "anthropic"]
    usage: dict[str, Any] = Field(default_factory=dict)


class FileCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str | None = None
    workspace_id: str | None = None
    file_name: str = Field(..., min_length=1, max_length=512)
    file_type: str | None = Field(default=None, max_length=255)
    size_bytes: int | None = Field(default=None, ge=0)
    metadata: dict[str, Any] | None = None


class FileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    workspace_id: str | None = None
    conversation_id: str | None = None
    file_name: str
    file_type: str | None = None
    size_bytes: int | None = None
    storage_path: str | None = None
    metadata: dict[str, Any] | None = None
    page_count: int | None = None
    extractor_used: str | None = None
    extracted_character_count: int = 0
    image_page_count: int = 0
    text_page_count: int = 0
    extraction_status: Literal["processing", "searchable", "ocr_required", "extraction_failed"] | None = None
    extraction_failure_reason: str | None = None
    processing_status: FileProcessingStatus | None = None
    processing_error: str | None = None
    processing_job_id: str | None = None
    ocr_used: bool = False
    ocr_character_count: int = 0
    created_at: datetime | None = None


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    parent_workspace_id: str | None = None
    workspace_type: WorkspaceType = "super_workspace"
    is_global: bool = False
    workspace_focus: WorkspaceFocusInput = "general"


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    expertise_area: str | None = Field(default=None, max_length=1000)
    workspace_focus: WorkspaceFocusInput | None = None
    ai_specialization: WorkspaceFocusInput | None = None
    ai_instructions: str | None = Field(default=None, max_length=4000)
    intelligence_preferences: dict[str, Any] | None = None


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    name: str
    description: str | None = None
    parent_workspace_id: str | None = None
    workspace_type: WorkspaceType = "super_workspace"
    is_global: bool = False
    expertise_area: str | None = None
    workspace_focus: WorkspaceFocus = "general"
    ai_specialization: WorkspaceAIMode = "general"
    ai_instructions: str | None = None
    intelligence_preferences: dict[str, Any] = Field(default_factory=dict)
    current_user_role: WorkspaceRole = "founder"
    member_count: int = 1
    is_shared: bool = False
    members_preview: list["WorkspaceMemberRead"] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WorkspaceSubspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    workspace_focus: WorkspaceFocusInput = "general"


class WorkspaceTreeRead(WorkspaceRead):
    subspaces: list[WorkspaceRead] = Field(default_factory=list)


class WorkspaceRelationshipValidation(BaseModel):
    workspace_id: str
    workspace_type: WorkspaceType
    parent_workspace_id: str | None = None
    is_global: bool = False
    is_valid: bool
    errors: list[str] = Field(default_factory=list)


class WorkspaceIntelligenceUpdate(BaseModel):
    expertise_area: str | None = Field(default=None, max_length=1000)
    workspace_focus: WorkspaceFocusInput | None = None
    ai_specialization: WorkspaceFocusInput | None = None
    ai_instructions: str | None = Field(default=None, max_length=4000)
    intelligence_preferences: dict[str, Any] = Field(default_factory=dict)


class WorkspaceIntelligenceRead(BaseModel):
    workspace_id: str
    workspace_name: str
    workspace_type: WorkspaceType
    is_global: bool = False
    parent_workspace_id: str | None = None
    description: str | None = None
    expertise_area: str | None = None
    workspace_focus: WorkspaceFocus = "general"
    ai_specialization: WorkspaceAIMode = "general"
    ai_instructions: str | None = None
    intelligence_preferences: dict[str, Any] = Field(default_factory=dict)
    source_count: int = 0
    conversation_count: int = 0
    member_count: int = 0
    active_domains: list[str] = Field(default_factory=list)
    connected_sources: list[dict[str, Any]] = Field(default_factory=list)
    recent_insights: list[str] = Field(default_factory=list)
    retrieval_scope: Literal["workspace", "global", "personal"] = "workspace"
    scope_workspace_ids: list[str] = Field(default_factory=list)
    context_summary: str


class WorkspacePresenceHeartbeat(BaseModel):
    current_view: str | None = Field(default=None, max_length=80)
    current_label: str | None = Field(default=None, max_length=255)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkspaceTypingUpdate(BaseModel):
    conversation_id: str | None = None
    is_typing: bool = True


class WorkspacePresenceMemberRead(BaseModel):
    workspace_id: str
    user_id: str
    status: Literal["online", "recent", "offline"] = "offline"
    current_view: str | None = None
    current_label: str | None = None
    is_online: bool = False
    is_typing: bool = False
    typing_conversation_id: str | None = None
    last_seen_at: datetime | None = None
    updated_at: datetime | None = None
    email: str | None = None
    full_name: str | None = None
    handle: str | None = None
    avatar_url: str | None = None
    avatar_label: str = "U"


class WorkspacePresenceRead(BaseModel):
    workspace_id: str
    online_count: int = 0
    active_count: int = 0
    recently_active_count: int = 0
    typing_count: int = 0
    online_members: list[WorkspacePresenceMemberRead] = Field(default_factory=list)
    active_members: list[WorkspacePresenceMemberRead] = Field(default_factory=list)
    recently_active_members: list[WorkspacePresenceMemberRead] = Field(default_factory=list)
    typing_members: list[WorkspacePresenceMemberRead] = Field(default_factory=list)
    updated_at: datetime | None = None


class WorkspaceActivityRead(BaseModel):
    id: str
    workspace_id: str
    actor_user_id: str | None = None
    event_type: str
    summary: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    actor_name: str | None = None
    actor_email: str | None = None
    actor_avatar_url: str | None = None
    actor_avatar_label: str = "O"


class WorkspaceLiveStatusRead(BaseModel):
    workspace_id: str
    online_count: int = 0
    active_count: int = 0
    recently_active_count: int = 0
    typing_count: int = 0
    source_count: int = 0
    workspace_focus: WorkspaceFocus = "general"
    ai_specialization: WorkspaceAIMode = "general"
    ai_status: Literal["ready", "learning", "active"] = "ready"
    health: Literal["quiet", "warming", "alive"] = "quiet"
    recent_activity_at: datetime | None = None
    recent_activity_summary: str | None = None


class WorkspaceMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_id: str
    user_id: str
    role: WorkspaceRole
    email: str | None = None
    full_name: str | None = None
    handle: str | None = None
    avatar_url: str | None = None
    avatar_label: str = "U"
    operational_label: str | None = Field(default=None, max_length=80)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WorkspaceMemberRoleUpdate(BaseModel):
    role: WorkspaceRole
    operational_label: str | None = Field(default=None, max_length=80)


class WorkspaceMemberAssign(BaseModel):
    user_id: str
    role: WorkspaceAssignableRole = "member"


class WorkspacePotentialMemberRead(BaseModel):
    user_id: str
    email: str | None = None
    full_name: str | None = None
    handle: str | None = None
    avatar_url: str | None = None
    avatar_label: str = "U"


class WorkspaceInviteCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    role: WorkspaceAssignableRole = "member"


class WorkspaceInviteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    invite_id: str
    workspace_id: str
    email: str
    role: WorkspaceAssignableRole
    status: Literal["pending", "accepted", "declined", "revoked"]
    invited_by: str | None = None
    accepted_by_user_id: str | None = None
    workspace_name: str | None = None
    inviter_name: str | None = None
    inviter_email: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    accepted_at: datetime | None = None


class CacheCreate(BaseModel):
    cache_key: str = Field(..., min_length=1, max_length=255)
    value: Any


class CacheRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    cache_key: str
    value: Any
    created_at: datetime | None = None
    updated_at: datetime | None = None


WorkspaceRead.model_rebuild()
WorkspaceTreeRead.model_rebuild()
