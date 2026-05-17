from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    email: str | None = None
    handle: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class UserProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    handle: str | None = Field(default=None, min_length=3, max_length=30)
    avatar_url: str | None = Field(default=None, max_length=300_000)
    remove_avatar: bool = False
