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
WORKSPACE_ACCESS_LOCATOR_COLUMNS = "id,user_id,parent_workspace_id,workspace_type,is_global"
LEGACY_WORKSPACE_ACCESS_LOCATOR_COLUMNS = "id,user_id"
_WORKSPACE_AUTHORITY_FIELDS = ("id", "user_id", "parent_workspace_id", "workspace_type", "is_global")


def active_workspace_id_from_request(request: Request) -> str | None:
    raw_value = request.headers.get("X-Omnix-Workspace")
    if raw_value is None:
        return None

    workspace_id = raw_value.strip()
    return workspace_id or None


async def _select_workspace_columns(
    filters: Mapping[str, Any],
    column_sets: tuple[tuple[str, str], ...],
) -> dict[str, Any] | None:
    last_error: SupabaseServiceError | None = None
    for index, (label, columns) in enumerate(column_sets):
        try:
            return await select_one_trusted("workspaces", columns, filters)
        except SupabaseServiceError as exc:
            last_error = exc
            if index < len(column_sets) - 1:
                logger.warning(
                    "Workspace read using %s schema failed; retrying narrower columns.",
                    label,
                    exc_info=True,
                )

    raise database_error() from last_error


async def select_workspace_record(filters: Mapping[str, Any]) -> dict[str, Any] | None:
    return await _select_workspace_columns(
        filters,
        (
            ("current", WORKSPACE_COLUMNS),
            ("hierarchy", HIERARCHY_WORKSPACE_COLUMNS),
            ("legacy", LEGACY_WORKSPACE_COLUMNS),
        ),
    )


async def _select_workspace_access_locator(
    filters: Mapping[str, Any],
) -> dict[str, Any] | None:
    return await _select_workspace_columns(
        filters,
        (
            ("hierarchy locator", WORKSPACE_ACCESS_LOCATOR_COLUMNS),
            ("legacy locator", LEGACY_WORKSPACE_ACCESS_LOCATOR_COLUMNS),
        ),
    )


def _membership_role(
    membership: dict[str, Any] | None,
    user_id: str,
    workspace: dict[str, Any],
) -> WorkspaceRole | None:
    if not membership:
        return None
    return normalize_workspace_role(
        membership.get("role"),
        member_user_id=user_id,
        owner_user_id=str(workspace.get("user_id") or ""),
    )


def _workspace_authority_matches(locator: dict[str, Any], hydrated: dict[str, Any]) -> bool:
    return all(
        locator.get(field) == hydrated.get(field)
        for field in _WORKSPACE_AUTHORITY_FIELDS
    )


async def resolve_workspace_access(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess | None:
    workspace_locator = await _select_workspace_access_locator({"id": workspace_id})
    if workspace_locator is None:
        return None

    workspace_locator = normalize_workspace_record(workspace_locator)
    parent_workspace_id = str(workspace_locator.get("parent_workspace_id") or "").strip()

    try:
        direct_membership = await select_one_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            {"workspace_id": workspace_id, "user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise database_error() from exc

    direct_role = _membership_role(direct_membership, user_id, workspace_locator)

    resolved_role: WorkspaceRole | None = None
    membership_uses_parent = False
    parent_locator: dict[str, Any] | None = None
    if not parent_workspace_id:
        resolved_role = direct_role
    else:
        parent_locator = await _select_workspace_access_locator({"id": parent_workspace_id})
        if parent_locator is None:
            return None

        parent_locator = normalize_workspace_record(parent_locator)
        if not is_super_workspace(parent_locator):
            return None

        try:
            parent_membership = await select_one_trusted(
                "workspace_members",
                WORKSPACE_MEMBER_COLUMNS,
                {"workspace_id": parent_workspace_id, "user_id": user_id},
            )
        except SupabaseServiceError as exc:
            raise database_error() from exc

        parent_role = _membership_role(parent_membership, user_id, parent_locator)

        if parent_role == "founder":
            resolved_role = "founder"
            membership_uses_parent = True
        elif workspace_locator.get("is_global") and parent_role:
            resolved_role = parent_role
            membership_uses_parent = True
        else:
            resolved_role = direct_role

    if resolved_role is None:
        return None

    workspace = await select_workspace_record({"id": workspace_id})
    if workspace is None:
        return None
    workspace = normalize_workspace_record(workspace)
    if not _workspace_authority_matches(workspace_locator, workspace):
        return None

    membership_workspace = workspace
    if membership_uses_parent:
        if parent_locator is None:
            return None
        parent_workspace = await select_workspace_record({"id": parent_workspace_id})
        if parent_workspace is None:
            return None
        parent_workspace = normalize_workspace_record(parent_workspace)
        if not _workspace_authority_matches(parent_locator, parent_workspace):
            return None
        membership_workspace = parent_workspace

    return WorkspaceAccess(
        workspace=workspace,
        role=resolved_role,
        membership_workspace=membership_workspace,
    )


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
