from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ConnectorType = Literal[
    "knowledge_link",
    "file_repository",
    "company_drive",
    "external_database",
]

ConnectorStatus = Literal[
    "live",
    "connecting",
    "connected",
    "syncing",
    "failed",
    "pending_ingestion",
    "request_submitted",
    "needs_authentication",
]


class ConnectorCreate(BaseModel):
    workspace_id: str | None = None
    connector_type: ConnectorType
    display_name: str | None = Field(default=None, max_length=160)
    config: dict[str, Any] = Field(default_factory=dict)


class ConnectorJobRead(BaseModel):
    id: str
    type: str | None = None
    status: str | None = None
    progress: int | None = None
    attempts: int | None = None
    error: str | None = None
    result: dict[str, Any] | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class ConnectorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    user_id: str
    connector_type: ConnectorType
    display_name: str
    status: ConnectorStatus
    config: dict[str, Any] = Field(default_factory=dict)
    last_error: str | None = None
    job_id: str | None = None
    source_file_id: str | None = None
    last_synced_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    job: ConnectorJobRead | None = None
