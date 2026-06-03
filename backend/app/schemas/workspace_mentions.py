from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


MentionSourceType = Literal["conversation_message", "task", "decision"]


class WorkspaceMentionInput(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=120)


class WorkspaceMentionMetadata(BaseModel):
    user_id: str
    label: str | None = None
    display_name: str | None = None
    email: str | None = None
    avatar_url: str | None = None
    avatar_label: str = "U"
    operational_label: str | None = None


class WorkspaceMentionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    mentioned_user_id: str
    mentioned_by_user_id: str
    source_type: MentionSourceType
    source_id: str
    created_at: datetime | None = None
    read_at: datetime | None = None
    mentioned_by_name: str | None = None
    mentioned_by_email: str | None = None
    mentioned_by_avatar_label: str = "U"
    mentioned_user_name: str | None = None
    source_title: str
    source_preview: str | None = None
    source_url: str
