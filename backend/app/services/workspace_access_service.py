from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

from fastapi import HTTPException, Request, status

from .supabase_service import SupabaseServiceError, select_one_trusted
from .workspace_common import (
    HIERARCHY_WORKSPACE_COLUMNS,
    LEGACY_WORKSPACE_COLUMNS,
    WORKSPACE_COLUMNS,
    WORKSPACE_MEMBER_COLUMNS,
    WorkspaceAccess,
    WorkspaceRole,
    database_error,
    is_super_workspace,
    normalize_workspace_record,
    normalize_workspace_role,
    workspace_not_found,
)
from .workspace_permissions import OrganizationalAccessAuthority

logger = logging.getLogger(__name__)


def active_workspace_id_from_request(request: Request) -> str | None:
    raw_value = request.headers.get("X-Omnix-Workspace")
    if raw_value is None:
        return None

    workspace_id = raw_value.strip()
    return workspace_id or None


async def select_workspace_record(filters: Mapping[str, Any]) -> dict[str, Any] | None:
    column_sets = (
        ("current", WORKSPACE_COLUMNS),
        ("hierarchy", HIERARCHY_WORKSPACE_COLUMNS),
        ("legacy", LEGACY_WORKSPACE_COLUMNS),
    )
    last_error: SupabaseServiceError | None = None
    for label, columns in column_sets:
        try:
            return await select_one_trusted("workspaces", columns, filters)
        except SupabaseServiceError as exc:
            last_error = exc
            if label != "legacy":
                logger.warning(
                    "Workspace read using %s schema failed; retrying narrower columns.",
                    label,
                    exc_info=True,
                )

    raise database_error() from last_error


async def resolve_workspace_access(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess | None:
    workspace = await select_workspace_record({"id": workspace_id})
    if workspace is None:
        return None

    workspace = normalize_workspace_record(workspace)
    parent_workspace_id = str(workspace.get("parent_workspace_id") or "").strip()

    try:
        direct_membership = await select_one_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            {"workspace_id": workspace_id, "user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise database_error() from exc

    direct_role: WorkspaceRole | None = None
    if direct_membership:
        direct_role = normalize_workspace_role(
            direct_membership.get("role"),
            member_user_id=user_id,
            owner_user_id=str(workspace.get("user_id") or ""),
        )

    if not parent_workspace_id:
        if direct_role:
            return WorkspaceAccess(
                workspace=workspace,
                role=direct_role,
                membership_workspace=workspace,
            )
        return None

    parent_workspace = await select_workspace_record({"id": parent_workspace_id})
    if parent_workspace is None:
        return None

    parent_workspace = normalize_workspace_record(parent_workspace)
    if not is_super_workspace(parent_workspace):
        return None

    try:
        parent_membership = await select_one_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            {"workspace_id": parent_workspace_id, "user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise database_error() from exc

    parent_role: WorkspaceRole | None = None
    if parent_membership:
        parent_role = normalize_workspace_role(
            parent_membership.get("role"),
            member_user_id=user_id,
            owner_user_id=str(parent_workspace.get("user_id") or ""),
        )

    if parent_role == "founder":
        return WorkspaceAccess(
            workspace=workspace,
            role="founder",
            membership_workspace=parent_workspace,
        )

    if workspace.get("is_global") and parent_role:
        return WorkspaceAccess(
            workspace=workspace,
            role=parent_role,
            membership_workspace=parent_workspace,
        )

    if direct_role:
        return WorkspaceAccess(
            workspace=workspace,
            role=direct_role,
            membership_workspace=workspace,
        )

    return None


async def require_workspace_access(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess:
    access = await resolve_workspace_access(workspace_id, user_id)
    if access is None:
        raise workspace_not_found()
    return access


async def require_workspace_management_access(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess:
    access = await require_workspace_access(workspace_id, user_id)
    workspace_type = access.workspace.get("workspace_type") or "workspace"
    if not OrganizationalAccessAuthority.can_manage_workspace(access.role, workspace_type):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage this workspace.",
        )
    return access


async def require_active_workspace_access(
    request: Request,
    user_id: str,
) -> WorkspaceAccess | None:
    workspace_id = active_workspace_id_from_request(request)
    if workspace_id is None:
        return None
    return await require_workspace_access(workspace_id, user_id)


def can_manage_workspace_resource(
    record_user_id: str | None,
    access: WorkspaceAccess,
    current_user_id: str,
) -> bool:
    return access.is_owner or (
        record_user_id is not None and record_user_id == current_user_id
    )


_select_workspace_record = select_workspace_record
