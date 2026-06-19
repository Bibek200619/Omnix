from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class WelcomeEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(..., min_length=3, max_length=320)
    name: str = Field(default="", max_length=80)
