from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_INPUT_SIZE = 4000


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    is_archived: bool | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
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


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_INPUT_SIZE)
    conversation_id: str | None = None
    title: str | None = Field(default=None, max_length=255)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)


class ChatResponse(BaseModel):
    conversation_id: str
    user_message_id: str
    assistant_message_id: str
    response: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    conversation: ConversationHistoryRead | None = None
    user_message: MessageRead | None = None
    assistant_message: MessageRead | None = None


class FileCreate(BaseModel):
    conversation_id: str | None = None
    workspace_id: str | None = None
    file_name: str = Field(..., min_length=1, max_length=512)
    file_type: str | None = Field(default=None, max_length=255)
    size_bytes: int | None = Field(default=None, ge=0)
    storage_path: str | None = Field(default=None, max_length=1024)
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
    created_at: datetime | None = None


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    name: str
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


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
