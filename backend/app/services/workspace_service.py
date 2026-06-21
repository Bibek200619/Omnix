from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

from fastapi import HTTPException, Request, status

from .supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_one,
    select_all,
    select_all_trusted,
    select_one_trusted,
)
from .workspace_cognition import normalize_workspace_focus
from .workspace_common import (
    GLOBAL_SPACE_NAME,
    HIERARCHY_WORKSPACE_COLUMNS,
    LEGACY_WORKSPACE_COLUMNS,
    MEMBERS_PREVIEW_LIMIT,
    WORKSPACE_COLUMNS,
    WORKSPACE_INVITE_COLUMNS,
    WORKSPACE_MEMBER_COLUMNS,
    WORKSPACE_TYPES,
    WorkspaceAIMode,
    WorkspaceAccess,
    WorkspaceInviteStatus,
    WorkspaceRole,
    WorkspaceType,
    database_error as _database_error,
    is_subspace,
    is_super_workspace,
    normalize_ai_specialization,
    normalize_email,
    normalize_intelligence_preferences,
    normalize_operational_label,
    normalize_workspace_record,
    normalize_workspace_role,
    normalize_workspace_type,
    utc_now_iso,
    workspace_not_found as _workspace_not_found,
    workspace_validation_error as _workspace_validation_error,
)
from .workspace_membership_service import (
    assign_member_to_subspace,
    get_profiles,
    hydrate_member_records as _hydrate_member_records,
    list_potential_subspace_members,
    list_workspace_members,
    membership_source_workspace,
)

logger = logging.getLogger(__name__)


def user_email_from_claims(current_user: Any) -> str | None:
    email = (
        current_user.get("email")
        if isinstance(current_user, Mapping)
        else getattr(current_user, "email", None)
    )
    if isinstance(email, str) and email.strip():
        return normalize_email(email)
    return None


def active_workspace_id_from_request(request: Request) -> str | None:
    raw_value = request.headers.get("X-Omnix-Workspace")
    if raw_value is None:
        return None

    workspace_id = raw_value.strip()
    return workspace_id or None


async def _select_workspace_record(filters: Mapping[str, Any]) -> dict[str, Any] | None:
    column_sets = (
        ("current", WORKSPACE_COLUMNS),
        ("hierarchy", HIERARCHY_WORKSPACE_COLUMNS),
        ("legacy", LEGACY_WORKSPACE_COLUMNS),
    )
    last_error: SupabaseServiceError | None = None
    for label, columns in column_sets:
        try:
            return await select_one_trusted(
                "workspaces",
                columns,
                filters,
            )
        except SupabaseServiceError as exc:
            last_error = exc
            if label != "legacy":
                logger.warning(
                    "Workspace read using %s schema failed; retrying narrower columns.",
                    label,
                    exc_info=True,
                )

    raise _database_error() from last_error


from app.services.workspace_permissions import OrganizationalAccessAuthority

async def resolve_workspace_access(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess | None:
    workspace = await _select_workspace_record({"id": workspace_id})

    if workspace is None:
        return None
    workspace = normalize_workspace_record(workspace)

    parent_workspace_id = str(workspace.get("parent_workspace_id") or "").strip()
    
    # 1. First, check for explicit direct membership on the workspace itself
    try:
        direct_membership = await select_one_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            {"workspace_id": workspace_id, "user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
        
    direct_role = None
    if direct_membership:
        owner_user_id = str(workspace.get("user_id") or "")
        direct_role = normalize_workspace_role(
            direct_membership.get("role"),
            member_user_id=user_id,
            owner_user_id=owner_user_id,
        )

    # If it's a top-level super workspace and we have direct membership, we're done
    if not parent_workspace_id:
        if direct_role:
            return WorkspaceAccess(workspace=workspace, role=direct_role, membership_workspace=workspace)
        return None

    # 2. It is a subworkspace. Let's get the parent workspace to check super founder or global visibility
    parent_workspace = await _select_workspace_record({"id": parent_workspace_id})

    if parent_workspace is None:
        return None

    parent_workspace = normalize_workspace_record(parent_workspace)
    if not is_super_workspace(parent_workspace):
        return None

    # 3. Check membership on the parent workspace
    try:
        parent_membership = await select_one_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            {"workspace_id": parent_workspace_id, "user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    parent_role = None
    if parent_membership:
        parent_owner_user_id = str(parent_workspace.get("user_id") or "")
        parent_role = normalize_workspace_role(
            parent_membership.get("role"),
            member_user_id=user_id,
            owner_user_id=parent_owner_user_id,
        )

    # 4. Resolve access rules
    is_global = workspace.get("is_global")
    
    # Rule A: Super Founder has access to all subworkspaces
    if parent_role == "founder":
        return WorkspaceAccess(
            workspace=workspace,
            role="founder",
            membership_workspace=parent_workspace,
        )

    # Rule B: Global workspace is visible to all members of the super workspace
    if is_global and parent_role:
        return WorkspaceAccess(
            workspace=workspace,
            role=parent_role, # Inherit role level from parent for global
            membership_workspace=parent_workspace,
        )
        
    # Rule C: Explicit direct membership required for non-global subspaces
    if direct_role:
        return WorkspaceAccess(
            workspace=workspace,
            role=direct_role,
            membership_workspace=workspace,
        )
        
    # Access Denied
    return None


async def require_workspace_access(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess:
    access = await resolve_workspace_access(workspace_id, user_id)
    if access is None:
        raise _workspace_not_found()
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
    return access.is_owner or (record_user_id is not None and record_user_id == current_user_id)


async def list_user_workspaces(user_id: str) -> list[dict[str, Any]]:
    try:
        owned_workspaces = [
            normalize_workspace_record(workspace)
            for workspace in await select_all(
                "workspaces",
                WORKSPACE_COLUMNS,
                filters={"user_id": user_id},
                order_by="created_at",
                desc=False,
            )
        ]
        membership_rows = await select_all(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            filters={"user_id": user_id},
            order_by="created_at",
            desc=False,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    owned_workspace_ids = {str(workspace["id"]) for workspace in owned_workspaces}
    shared_workspace_ids = [
        str(row["workspace_id"])
        for row in membership_rows
        if row.get("workspace_id") and str(row["workspace_id"]) not in owned_workspace_ids
    ]

    try:
        shared_workspaces = (
            [
                normalize_workspace_record(workspace)
                for workspace in await select_all_trusted(
                    "workspaces",
                    WORKSPACE_COLUMNS,
                    filters={"id": shared_workspace_ids},
                    order_by="created_at",
                    desc=False,
                )
            ]
            if shared_workspace_ids
            else []
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    workspace_by_id: dict[str, dict[str, Any]] = {}
    role_by_workspace_id: dict[str, WorkspaceRole] = {}

    for workspace in owned_workspaces:
        workspace_id = str(workspace["id"])
        workspace_by_id[workspace_id] = workspace
        role_by_workspace_id[workspace_id] = "founder"

    for row in membership_rows:
        workspace_id = str(row.get("workspace_id") or "")
        if not workspace_id:
            continue
        if workspace_id not in role_by_workspace_id:
            role_by_workspace_id[workspace_id] = normalize_workspace_role(row.get("role"))

    for workspace in shared_workspaces:
        workspace_by_id.setdefault(str(workspace["id"]), workspace)

    super_workspace_ids = [
        str(workspace_id)
        for workspace_id, workspace in workspace_by_id.items()
        if is_super_workspace(workspace)
    ]
    try:
        all_inherited_subspaces = (
            [
                normalize_workspace_record(workspace)
                for workspace in await select_all_trusted(
                    "workspaces",
                    WORKSPACE_COLUMNS,
                    filters={"parent_workspace_id": super_workspace_ids},
                    order_by="created_at",
                    desc=False,
                )
            ]
            if super_workspace_ids
            else []
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
        
    # Build list of all user memberships (including owned ones conceptually) for filtering
    virtual_memberships = list(membership_rows)
    for wid in owned_workspace_ids:
        virtual_memberships.append({"workspace_id": wid, "user_id": user_id, "role": "founder"})
        
    super_founder_workspace_ids = {
        wid for wid, role in role_by_workspace_id.items() 
        if role == "founder" and is_super_workspace(workspace_by_id[wid])
    }

    inherited_subspaces = OrganizationalAccessAuthority.filter_visible_workspaces(
        all_inherited_subspaces,
        virtual_memberships,
        super_founder_workspace_ids=super_founder_workspace_ids
    )

    for workspace in inherited_subspaces:
        workspace_id = str(workspace["id"])
        parent_workspace_id = str(workspace.get("parent_workspace_id") or "")
        workspace_by_id.setdefault(workspace_id, workspace)
        role_by_workspace_id.setdefault(
            workspace_id,
            role_by_workspace_id.get(parent_workspace_id, "member"),
        )

    workspaces = [
        workspace
        for workspace in workspace_by_id.values()
        if not (
            is_subspace(workspace)
            and workspace.get("parent_workspace_id")
            and str(workspace["parent_workspace_id"]) not in workspace_by_id
        )
    ]
    membership_workspace_by_workspace_id: dict[str, dict[str, Any]] = {}
    for workspace in workspaces:
        workspace_id = str(workspace["id"])
        parent_workspace_id = str(workspace.get("parent_workspace_id") or "")
        # Global workspaces inherit from parent; private subspaces do not.
        membership_workspace_by_workspace_id[workspace_id] = (
            workspace_by_id.get(parent_workspace_id, workspace)
            if parent_workspace_id and workspace.get("is_global")
            else workspace
        )

    membership_workspace_ids = sorted(
        {
            str(workspace["id"])
            for workspace in membership_workspace_by_workspace_id.values()
            if workspace.get("id")
        }
    )

    try:
        all_member_rows = (
            await select_all_trusted(
                "workspace_members",
                WORKSPACE_MEMBER_COLUMNS,
                filters={"workspace_id": membership_workspace_ids},
                order_by="created_at",
                desc=False,
            )
            if membership_workspace_ids
            else []
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    member_rows_by_workspace_id: dict[str, list[dict[str, Any]]] = {}
    user_ids: list[str] = []

    for workspace in workspaces:
        membership_workspace = membership_workspace_by_workspace_id[str(workspace["id"])]
        user_ids.append(str(membership_workspace.get("user_id") or ""))

    for row in all_member_rows:
        workspace_id = str(row.get("workspace_id") or "")
        member_rows_by_workspace_id.setdefault(workspace_id, []).append(row)
        user_ids.append(str(row.get("user_id") or ""))

    profiles = await get_profiles(user_ids)

    enriched: list[dict[str, Any]] = []
    for workspace in workspaces:
        workspace_id = str(workspace["id"])
        membership_workspace = membership_workspace_by_workspace_id[workspace_id]
        membership_workspace_id = str(membership_workspace["id"])
        members = _hydrate_member_records(
            membership_workspace,
            member_rows_by_workspace_id.get(membership_workspace_id, []),
            profiles,
            response_workspace_id=workspace_id,
        )
        current_role = role_by_workspace_id.get(workspace_id, "member")
        enriched.append(
            {
                **workspace,
                "current_user_role": current_role,
                "member_count": len(members),
                "is_shared": len(members) > 1,
                "members_preview": members[:MEMBERS_PREVIEW_LIMIT],
            }
        )

    enriched.sort(key=lambda item: item.get("created_at") or "")
    return enriched


def _normalized_workspace_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise _workspace_validation_error("Workspace name cannot be empty.")
    return normalized


def _workspace_insert_payload(
    *,
    user_id: str,
    name: str,
    description: str | None,
    workspace_type: WorkspaceType,
    parent_workspace_id: str | None,
    is_global: bool,
    timestamp: str,
    workspace_focus: Any = "general",
) -> dict[str, Any]:
    focus = normalize_ai_specialization(workspace_focus)
    return {
        "user_id": user_id,
        "name": _normalized_workspace_name(name),
        "description": description,
        "parent_workspace_id": parent_workspace_id,
        "workspace_type": workspace_type,
        "is_global": is_global,
        "workspace_focus": focus,
        "ai_specialization": focus,
        "updated_at": timestamp,
    }


async def _create_owner_membership(
    *,
    workspace_id: str,
    user_id: str,
    timestamp: str,
) -> None:
    await insert_one(
        "workspace_members",
        {
            "workspace_id": workspace_id,
            "user_id": user_id,
            "role": "owner",
            "created_at": timestamp,
            "updated_at": timestamp,
        },
    )


async def _cleanup_workspace_creation(workspace_ids: list[str]) -> None:
    for workspace_id in workspace_ids:
        try:
            await delete_many_trusted("workspace_members", {"workspace_id": workspace_id})
            await delete_many_trusted("workspaces", {"id": workspace_id})
        except Exception:
            logger.exception("Failed to clean up partially created workspace")


async def _global_spaces_for_super_workspace(super_workspace_id: str) -> list[dict[str, Any]]:
    try:
        rows = await select_all_trusted(
            "workspaces",
            WORKSPACE_COLUMNS,
            filters={"parent_workspace_id": super_workspace_id, "is_global": True},
            order_by="created_at",
            desc=False,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return [normalize_workspace_record(row) for row in rows]


async def get_global_space_for_super_workspace(
    super_workspace_id: str,
) -> dict[str, Any] | None:
    global_spaces = await _global_spaces_for_super_workspace(super_workspace_id)
    if len(global_spaces) > 1:
        logger.error(
            "Duplicate global spaces detected | super_workspace_id=%s | count=%d",
            super_workspace_id,
            len(global_spaces),
        )
    return global_spaces[0] if global_spaces else None


async def ensure_global_space_for_super_workspace(
    super_workspace: dict[str, Any],
    *,
    timestamp: str | None = None,
) -> dict[str, Any]:
    super_workspace = normalize_workspace_record(super_workspace)
    if not is_super_workspace(super_workspace):
        raise _workspace_validation_error("Global spaces can only belong to a super workspace.")

    existing_global_space = await get_global_space_for_super_workspace(str(super_workspace["id"]))
    if existing_global_space is not None:
        return existing_global_space

    created = await insert_one(
        "workspaces",
        _workspace_insert_payload(
            user_id=str(super_workspace["user_id"]),
            name=GLOBAL_SPACE_NAME,
            description="Company-wide collaboration and announcements.",
            workspace_type="global_workspace",
            parent_workspace_id=str(super_workspace["id"]),
            is_global=True,
            timestamp=timestamp or utc_now_iso(),
        ),
    )
    return normalize_workspace_record(created)


async def require_subspace_create_permission(
    parent_workspace_id: str,
    user_id: str,
) -> WorkspaceAccess:
    parent_access = await require_workspace_management_access(parent_workspace_id, user_id)
    if not is_super_workspace(parent_access.workspace):
        raise _workspace_validation_error("Subspaces can only be created under a super workspace.")
    return parent_access


async def create_subspace_for_user(
    *,
    user_id: str,
    parent_workspace_id: str | None,
    name: str,
    description: str | None = None,
    workspace_focus: Any = "general",
    is_global: bool = False,
    timestamp: str | None = None,
) -> dict[str, Any]:
    if not parent_workspace_id:
        raise _workspace_validation_error("Subspaces require a parent super workspace.")
    if is_global:
        raise _workspace_validation_error("Global spaces are created automatically for super workspaces.")

    parent_access = await require_subspace_create_permission(parent_workspace_id, user_id)
    created = await insert_one(
        "workspaces",
        _workspace_insert_payload(
            user_id=user_id,
            name=name,
            description=description,
            workspace_type="global_workspace" if is_global else "subworkspace",
            parent_workspace_id=parent_workspace_id,
            is_global=is_global,
            workspace_focus=workspace_focus,
            timestamp=timestamp or utc_now_iso(),
        ),
    )
    subspace = normalize_workspace_record(created)

    if subspace.get("parent_workspace_id") == str(subspace.get("id")):
        await _cleanup_workspace_creation([str(subspace["id"])])
        raise _workspace_validation_error("A workspace cannot be its own parent.")

    return {
        **subspace,
        "current_user_role": parent_access.role,
    }


async def create_workspace_for_user(
    *,
    user_id: str,
    name: str,
    description: str | None = None,
    workspace_focus: Any = "general",
    workspace_type: Any = "super_workspace",
    parent_workspace_id: str | None = None,
    is_global: bool = False,
) -> dict[str, Any]:
    requested_workspace_type = str(workspace_type or "").strip().lower().replace("-", "_")
    if requested_workspace_type and requested_workspace_type not in WORKSPACE_TYPES:
        raise _workspace_validation_error("Invalid workspace_type.")

    normalized_type = normalize_workspace_type(
        workspace_type,
        parent_workspace_id=parent_workspace_id,
    )
    timestamp = utc_now_iso()

    if normalized_type in {"subworkspace", "global_workspace"}:
        return await create_subspace_for_user(
            user_id=user_id,
            parent_workspace_id=parent_workspace_id,
            name=name,
            description=description,
            workspace_focus=workspace_focus,
            is_global=is_global,
            timestamp=timestamp,
        )

    if parent_workspace_id:
        raise _workspace_validation_error("Only subspaces can have a parent workspace.")
    if is_global:
        raise _workspace_validation_error("Only automatic subspaces can be marked as global.")

    created_workspace_ids: list[str] = []
    try:
        workspace = await insert_one(
            "workspaces",
            _workspace_insert_payload(
                user_id=user_id,
                name=name,
                description=description,
                workspace_type=normalized_type,
                parent_workspace_id=None,
                is_global=False,
                workspace_focus=workspace_focus,
                timestamp=timestamp,
            ),
        )
        workspace = normalize_workspace_record(workspace)
        created_workspace_ids.append(str(workspace["id"]))
        await _create_owner_membership(
            workspace_id=str(workspace["id"]),
            user_id=user_id,
            timestamp=timestamp,
        )

        if normalized_type == "super_workspace":
            global_space = await ensure_global_space_for_super_workspace(
                workspace,
                timestamp=timestamp,
            )
            created_workspace_ids.append(str(global_space["id"]))

        return workspace
    except HTTPException:
        await _cleanup_workspace_creation(created_workspace_ids)
        raise
    except SupabaseServiceError as exc:
        await _cleanup_workspace_creation(created_workspace_ids)
        raise _database_error() from exc


async def list_subspaces_for_super_workspace(
    super_workspace_id: str,
    user_id: str,
) -> list[dict[str, Any]]:
    access = await require_workspace_access(super_workspace_id, user_id)
    if not is_super_workspace(access.workspace):
        raise _workspace_validation_error("Workspace is not a super workspace.")

    try:
        rows = await select_all_trusted(
            "workspaces",
            WORKSPACE_COLUMNS,
            filters={"parent_workspace_id": super_workspace_id},
            order_by="created_at",
            desc=False,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    all_subspaces = [normalize_workspace_record(row) for row in rows]
    
    # Super founders see everything
    if access.role == "founder":
        visible_subspaces = all_subspaces
    else:
        # Otherwise, fetch user's direct memberships to filter
        try:
            user_memberships = await select_all_trusted(
                "workspace_members",
                WORKSPACE_MEMBER_COLUMNS,
                filters={"user_id": user_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
            
        visible_subspaces = OrganizationalAccessAuthority.filter_visible_workspaces(
            all_subspaces, 
            user_memberships
        )

    visible_subspaces.sort(key=lambda item: (not bool(item.get("is_global")), item.get("created_at") or ""))
    return visible_subspaces


async def validate_workspace_relationship(
    workspace_id: str,
    user_id: str,
) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    workspace = normalize_workspace_record(access.workspace)
    workspace_type = normalize_workspace_type(
        workspace.get("workspace_type"),
        parent_workspace_id=workspace.get("parent_workspace_id"),
    )
    parent_workspace_id = workspace.get("parent_workspace_id")
    errors: list[str] = []

    if workspace_type == "super_workspace" and parent_workspace_id:
        errors.append("Super workspaces cannot have a parent workspace.")
    if workspace.get("is_global") and workspace_type not in {"subworkspace", "global_workspace"}:
        errors.append("Only subspaces can be marked global.")
    if parent_workspace_id and str(parent_workspace_id) == str(workspace["id"]):
        errors.append("A workspace cannot be its own parent.")

    if workspace_type in {"subworkspace", "global_workspace"}:
        if not parent_workspace_id:
            errors.append("Subspaces require a parent workspace.")
        else:
            try:
                parent_workspace = await select_one_trusted(
                    "workspaces",
                    WORKSPACE_COLUMNS,
                    {"id": str(parent_workspace_id)},
                )
            except SupabaseServiceError as exc:
                raise _database_error() from exc

            if parent_workspace is None:
                errors.append("Subspace parent workspace does not exist.")
            else:
                parent_workspace = normalize_workspace_record(parent_workspace)
                if parent_workspace.get("parent_workspace_id"):
                    errors.append("Nested subspaces are not supported.")
                if not is_super_workspace(parent_workspace):
                    errors.append("Subspace parent must be a super workspace.")

        if workspace.get("is_global") and parent_workspace_id:
            global_spaces = await _global_spaces_for_super_workspace(str(parent_workspace_id))
            duplicate_global_spaces = [
                row for row in global_spaces if str(row.get("id")) != str(workspace["id"])
            ]
            if duplicate_global_spaces:
                errors.append("Duplicate global spaces exist for this super workspace.")

    return {
        "workspace_id": str(workspace["id"]),
        "workspace_type": workspace_type,
        "parent_workspace_id": parent_workspace_id,
        "is_global": bool(workspace.get("is_global")),
        "is_valid": not errors,
        "errors": errors,
    }


async def hydrate_invites(invites: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not invites:
        return []

    workspace_ids = sorted(
        {
            str(invite["workspace_id"])
            for invite in invites
            if invite.get("workspace_id")
        }
    )
    inviter_ids = sorted(
        {
            str(invite["invited_by"])
            for invite in invites
            if invite.get("invited_by")
        }
    )

    try:
        workspace_rows = (
            await select_all_trusted(
                "workspaces",
                WORKSPACE_COLUMNS,
                filters={"id": workspace_ids},
            )
            if workspace_ids
            else []
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    workspace_by_id = {str(workspace["id"]): workspace for workspace in workspace_rows}
    profiles = await get_profiles(inviter_ids)

    hydrated: list[dict[str, Any]] = []
    for invite in invites:
        invite_id = str(invite.get("invite_id") or invite.get("id") or "")
        inviter_id = str(invite.get("invited_by") or "")
        workspace = workspace_by_id.get(str(invite.get("workspace_id") or ""))
        profile = profiles.get(inviter_id, {})
        hydrated.append(
            {
                **invite,
                "id": invite_id,
                "invite_id": invite_id,
                "invited_by": inviter_id or None,
                "workspace_name": workspace.get("name") if workspace else None,
                "inviter_name": profile.get("full_name"),
                "inviter_email": profile.get("email"),
            }
        )
    return hydrated


async def list_workspace_invites(workspace_id: str) -> list[dict[str, Any]]:
    try:
        invites = await select_all_trusted(
            "workspace_invites",
            WORKSPACE_INVITE_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="created_at",
            desc=True,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return await hydrate_invites(invites)


async def list_pending_invites_for_email(email: str) -> list[dict[str, Any]]:
    normalized_email = normalize_email(email)

    try:
        invites = await select_all_trusted(
            "workspace_invites",
            WORKSPACE_INVITE_COLUMNS,
            filters={"email": normalized_email, "status": "pending"},
            order_by="created_at",
            desc=True,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return await hydrate_invites(invites)
