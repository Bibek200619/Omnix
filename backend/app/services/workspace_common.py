from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import HTTPException, status

from .workspace_cognition import WorkspaceFocus, normalize_workspace_focus

WORKSPACE_COLUMNS = (
    "id,user_id,name,description,parent_workspace_id,workspace_type,is_global,"
    "expertise_area,workspace_focus,ai_specialization,ai_instructions,intelligence_preferences,"
    "created_at,updated_at"
)
HIERARCHY_WORKSPACE_COLUMNS = "id,user_id,name,description,parent_workspace_id,workspace_type,is_global,created_at,updated_at"
LEGACY_WORKSPACE_COLUMNS = "id,user_id,name,description,created_at,updated_at"
WORKSPACE_MEMBER_COLUMNS = "workspace_id,user_id,role,operational_label,created_at,updated_at"
WORKSPACE_INVITE_COLUMNS = (
    "id,workspace_id,email,role,status,invited_by,accepted_by_user_id,"
    "created_at,updated_at,accepted_at"
)
MEMBERS_PREVIEW_LIMIT = 3

WorkspaceRole = Literal["founder", "co_owner", "team_lead", "member"]
WorkspaceInviteStatus = Literal["pending", "accepted", "declined", "revoked"]
WorkspaceType = Literal["workspace", "super_workspace", "subworkspace", "global_workspace"]
WorkspaceAIMode = WorkspaceFocus
WORKSPACE_TYPES: set[str] = {"workspace", "super_workspace", "subworkspace", "global_workspace", "super", "sub"}
WORKSPACE_AI_MODES: set[str] = {"general", "engineering", "design", "research", "strategy"}
GLOBAL_SPACE_NAME = "Global"


@dataclass(slots=True)
class WorkspaceAccess:
    workspace: dict[str, Any]
    role: WorkspaceRole
    membership_workspace: dict[str, Any] | None = None

    @property
    def workspace_id(self) -> str:
        return str(self.workspace["id"])

    @property
    def membership_workspace_id(self) -> str:
        workspace = self.membership_workspace or self.workspace
        return str(workspace["id"])

    @property
    def is_founder(self) -> bool:
        return self.role == "founder"

    @property
    def is_owner(self) -> bool:
        return self.is_founder


def normalize_workspace_role(
    value: Any,
    *,
    member_user_id: str | None = None,
    owner_user_id: str | None = None,
) -> WorkspaceRole:
    if owner_user_id and member_user_id and member_user_id == owner_user_id:
        return "founder"

    role = str(value or "").strip().lower().replace("-", "_")
    if role == "founder":
        return "founder"
    if role == "owner":
        return "founder" if owner_user_id and member_user_id == owner_user_id else "co_owner"
    if role == "co_owner" or role == "sub_leader":
        return "co_owner"
    if role == "team_lead":
        return "team_lead"
    return "member"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_workspace_type(value: Any, *, parent_workspace_id: str | None = None) -> WorkspaceType:
    workspace_type = str(value or "").strip().lower().replace("-", "_")
    if workspace_type == "super":
        return "super_workspace"
    if workspace_type == "sub":
        return "subworkspace"
    if workspace_type == "global":
        return "global_workspace"
    if workspace_type == "workspace":
        return "workspace"

    if workspace_type in WORKSPACE_TYPES:
        return workspace_type  # type: ignore[return-value]

    if parent_workspace_id:
        return "subworkspace"
    return "super_workspace"


def normalize_workspace_record(workspace: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(workspace)
    parent_workspace_id = str(normalized.get("parent_workspace_id") or "").strip() or None
    normalized["parent_workspace_id"] = parent_workspace_id
    normalized["workspace_type"] = normalize_workspace_type(
        normalized.get("workspace_type"),
        parent_workspace_id=parent_workspace_id,
    )
    normalized["is_global"] = bool(normalized.get("is_global"))
    normalized["expertise_area"] = clean_optional_text(normalized.get("expertise_area"))
    workspace_focus = normalize_workspace_focus(
        normalized.get("workspace_focus") or normalized.get("ai_specialization")
    )
    normalized["workspace_focus"] = workspace_focus
    normalized["ai_specialization"] = workspace_focus
    normalized["ai_instructions"] = clean_optional_text(normalized.get("ai_instructions"))
    normalized["intelligence_preferences"] = normalize_intelligence_preferences(
        normalized.get("intelligence_preferences"),
        is_global=normalized["is_global"],
    )
    return normalized


def clean_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_operational_label(value: Any) -> str | None:
    label = clean_optional_text(value)
    return label[:80] if label else None


def normalize_ai_specialization(value: Any) -> WorkspaceAIMode:
    return normalize_workspace_focus(value)


def normalize_intelligence_preferences(
    value: Any,
    *,
    is_global: bool = False,
) -> dict[str, Any]:
    preferences = dict(value) if isinstance(value, Mapping) else {}
    retrieval_scope = str(preferences.get("retrieval_scope") or "").strip().lower()
    if retrieval_scope not in {"workspace", "global"}:
        retrieval_scope = "global" if is_global else "workspace"
    source_permissions = str(preferences.get("source_permissions") or "").strip().lower()
    if source_permissions not in {"workspace_only", "inherit_global", "organization"}:
        source_permissions = "organization" if is_global else "workspace_only"
    memory_enabled = preferences.get("memory_enabled")
    if not isinstance(memory_enabled, bool):
        memory_enabled = True
    return {
        **preferences,
        "retrieval_scope": retrieval_scope,
        "source_permissions": source_permissions,
        "memory_enabled": memory_enabled,
    }


def is_super_workspace(workspace: dict[str, Any]) -> bool:
    normalized = normalize_workspace_record(workspace)
    return normalized["workspace_type"] == "super_workspace" and normalized.get("parent_workspace_id") is None


def is_subspace(workspace: dict[str, Any]) -> bool:
    normalized = normalize_workspace_record(workspace)
    return normalized["workspace_type"] in {"subworkspace", "global_workspace"} or normalized.get("parent_workspace_id") is not None


def workspace_validation_error(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


def workspace_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Workspace not found.",
    )
