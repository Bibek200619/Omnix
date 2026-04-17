from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from typing import Any, Literal

from fastapi import HTTPException, Request, status
from starlette.concurrency import run_in_threadpool

from ..db.supabase_client import get_supabase
from .supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_one,
    select_all,
    select_all_trusted,
    select_one_trusted,
)
from .profile_service import get_user_profile_map

logger = logging.getLogger(__name__)

WORKSPACE_COLUMNS = (
    "id,user_id,name,description,parent_workspace_id,workspace_type,is_global,"
    "created_at,updated_at"
)
WORKSPACE_MEMBER_COLUMNS = "workspace_id,user_id,role,created_at,updated_at"
WORKSPACE_INVITE_COLUMNS = (
    "id,workspace_id,email,role,status,invited_by,accepted_by_user_id,"
    "created_at,updated_at,accepted_at"
)
MEMBERS_PREVIEW_LIMIT = 3

WorkspaceRole = Literal["founder", "co_owner", "member"]
WorkspaceInviteStatus = Literal["pending", "accepted", "declined", "revoked"]
WorkspaceType = Literal["workspace", "super", "sub"]
WORKSPACE_TYPES: set[str] = {"workspace", "super", "sub"}
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
    if role == "co_owner":
        return "co_owner"
    return "member"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_workspace_type(value: Any, *, parent_workspace_id: str | None = None) -> WorkspaceType:
    workspace_type = str(value or "").strip().lower().replace("-", "_")
    if workspace_type in WORKSPACE_TYPES:
        return workspace_type  # type: ignore[return-value]
    if parent_workspace_id:
        return "sub"
    return "workspace"


def normalize_workspace_record(workspace: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(workspace)
    parent_workspace_id = str(normalized.get("parent_workspace_id") or "").strip() or None
    normalized["parent_workspace_id"] = parent_workspace_id
    normalized["workspace_type"] = normalize_workspace_type(
        normalized.get("workspace_type"),
        parent_workspace_id=parent_workspace_id,
    )
    normalized["is_global"] = bool(normalized.get("is_global"))
    return normalized


def is_super_workspace(workspace: dict[str, Any]) -> bool:
    normalized = normalize_workspace_record(workspace)
    return normalized["workspace_type"] == "super" and normalized.get("parent_workspace_id") is None


def is_subspace(workspace: dict[str, Any]) -> bool:
    normalized = normalize_workspace_record(workspace)
    return normalized["workspace_type"] == "sub" or normalized.get("parent_workspace_id") is not None


def _workspace_validation_error(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


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


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


def _workspace_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Workspace not found.",
    )


async def resolve_workspace_access(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess | None:
    try:
        workspace = await select_one_trusted(
            "workspaces",
            WORKSPACE_COLUMNS,
            {"id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if workspace is None:
        return None
    workspace = normalize_workspace_record(workspace)

    parent_workspace_id = str(workspace.get("parent_workspace_id") or "").strip()
    if parent_workspace_id:
        try:
            parent_workspace = await select_one_trusted(
                "workspaces",
                WORKSPACE_COLUMNS,
                {"id": parent_workspace_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc

        if parent_workspace is None:
            return None

        parent_workspace = normalize_workspace_record(parent_workspace)
        if not is_super_workspace(parent_workspace):
            return None

        parent_owner_user_id = str(parent_workspace.get("user_id") or "")
        if parent_owner_user_id == user_id:
            return WorkspaceAccess(
                workspace=workspace,
                role="founder",
                membership_workspace=parent_workspace,
            )

        try:
            parent_membership = await select_one_trusted(
                "workspace_members",
                WORKSPACE_MEMBER_COLUMNS,
                {"workspace_id": parent_workspace_id, "user_id": user_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc

        if parent_membership is None:
            return None

        role = normalize_workspace_role(
            parent_membership.get("role"),
            member_user_id=user_id,
            owner_user_id=parent_owner_user_id,
        )
        return WorkspaceAccess(
            workspace=workspace,
            role=role,
            membership_workspace=parent_workspace,
        )

    owner_user_id = str(workspace.get("user_id") or "")
    if owner_user_id == user_id:
        return WorkspaceAccess(workspace=workspace, role="founder", membership_workspace=workspace)

    try:
        membership = await select_one_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            {"workspace_id": workspace_id, "user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if membership is None:
        return None

    role = normalize_workspace_role(
        membership.get("role"),
        member_user_id=user_id,
        owner_user_id=owner_user_id,
    )
    return WorkspaceAccess(workspace=workspace, role=role, membership_workspace=workspace)


async def require_workspace_access(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess:
    access = await resolve_workspace_access(workspace_id, user_id)
    if access is None:
        raise _workspace_not_found()
    return access


async def require_workspace_owner(
    workspace_id: str,
    user_id: str,
) -> WorkspaceAccess:
    access = await require_workspace_access(workspace_id, user_id)
    if not access.is_founder:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace founder can perform this action.",
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


def _display_name_for_user(user: Any) -> str | None:
    metadata = getattr(user, "user_metadata", None) or {}
    for key in ("full_name", "name"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _avatar_label(full_name: str | None, email: str | None, user_id: str) -> str:
    for candidate in (full_name, email, user_id):
        if isinstance(candidate, str):
            normalized = candidate.strip()
            if normalized:
                return normalized[0].upper()
    return "U"


def _lookup_profiles_sync(user_ids: list[str]) -> dict[str, dict[str, Any]]:
    profiles: dict[str, dict[str, Any]] = {}
    auth_admin = get_supabase().auth.admin

    for user_id in sorted({value for value in user_ids if value}):
        email: str | None = None
        full_name: str | None = None

        try:
            user_response = auth_admin.get_user_by_id(user_id)
            user = getattr(user_response, "user", None)
            email = getattr(user, "email", None)
            full_name = _display_name_for_user(user)
        except Exception:
            logger.exception("Failed to resolve user profile for %s.", user_id)

        profiles[user_id] = {
            "email": email,
            "full_name": full_name,
            "handle": None,
            "avatar_url": None,
            "avatar_label": _avatar_label(full_name, email, user_id),
        }

    return profiles


async def get_profiles(user_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not user_ids:
        return {}
    auth_profiles = await run_in_threadpool(_lookup_profiles_sync, user_ids)
    app_profiles = await get_user_profile_map(user_ids)

    for user_id, app_profile in app_profiles.items():
        profile = auth_profiles.setdefault(
            user_id,
            {
                "email": None,
                "full_name": None,
                "handle": None,
                "avatar_url": None,
                "avatar_label": _avatar_label(None, None, user_id),
            },
        )
        display_name = app_profile.get("display_name") or profile.get("full_name")
        avatar_url = app_profile.get("avatar_url") or profile.get("avatar_url")
        handle = app_profile.get("username") or profile.get("handle")
        profile["full_name"] = display_name
        profile["avatar_url"] = avatar_url
        profile["handle"] = handle
        profile["avatar_label"] = _avatar_label(display_name, profile.get("email") or handle, user_id)

    return auth_profiles


def _hydrate_member_records(
    workspace: dict[str, Any],
    member_rows: list[dict[str, Any]],
    profiles: dict[str, dict[str, Any]],
    *,
    response_workspace_id: str | None = None,
) -> list[dict[str, Any]]:
    workspace = normalize_workspace_record(workspace)
    owner_user_id = str(workspace.get("user_id") or "")
    output_workspace_id = response_workspace_id or str(workspace.get("id"))
    member_map: dict[str, dict[str, Any]] = {
        str(row.get("user_id")): row
        for row in member_rows
        if row.get("user_id")
    }

    if owner_user_id and owner_user_id not in member_map:
        member_map[owner_user_id] = {
            "workspace_id": output_workspace_id,
            "user_id": owner_user_id,
            "role": "founder",
            "created_at": workspace.get("created_at"),
            "updated_at": workspace.get("updated_at"),
        }

    members: list[dict[str, Any]] = []
    for member_user_id, row in member_map.items():
        role = normalize_workspace_role(
            row.get("role"),
            member_user_id=member_user_id,
            owner_user_id=owner_user_id,
        )
        profile = profiles.get(member_user_id, {})
        members.append(
            {
                "workspace_id": output_workspace_id,
                "user_id": member_user_id,
                "role": role,
                "email": profile.get("email"),
                "full_name": profile.get("full_name"),
                "handle": profile.get("handle"),
                "avatar_url": profile.get("avatar_url"),
                "avatar_label": profile.get("avatar_label") or _avatar_label(None, None, member_user_id),
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
            }
        )

    members.sort(
        key=lambda item: (
            {"founder": 0, "co_owner": 1, "member": 2}.get(item["role"], 3),
            (item.get("full_name") or item.get("email") or item["user_id"]).lower(),
        )
    )
    return members


async def membership_source_workspace(workspace: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_workspace_record(workspace)
    parent_workspace_id = normalized.get("parent_workspace_id")
    if not parent_workspace_id:
        return normalized

    try:
        parent_workspace = await select_one_trusted(
            "workspaces",
            WORKSPACE_COLUMNS,
            {"id": str(parent_workspace_id)},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if parent_workspace is None:
        return normalized

    parent_workspace = normalize_workspace_record(parent_workspace)
    return parent_workspace if is_super_workspace(parent_workspace) else normalized


async def list_workspace_members(
    workspace: dict[str, Any],
) -> list[dict[str, Any]]:
    requested_workspace = normalize_workspace_record(workspace)
    membership_workspace = await membership_source_workspace(requested_workspace)
    membership_workspace_id = str(membership_workspace["id"])

    try:
        member_rows = await select_all_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            filters={"workspace_id": membership_workspace_id},
            order_by="created_at",
            desc=False,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    user_ids = [str(membership_workspace.get("user_id") or "")]
    user_ids.extend(str(row.get("user_id") or "") for row in member_rows)
    profiles = await get_profiles(user_ids)
    return _hydrate_member_records(
        membership_workspace,
        member_rows,
        profiles,
        response_workspace_id=str(requested_workspace["id"]),
    )


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
        inherited_subspaces = (
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
        membership_workspace_by_workspace_id[workspace_id] = (
            workspace_by_id.get(parent_workspace_id, workspace)
            if parent_workspace_id
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
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "name": _normalized_workspace_name(name),
        "description": description,
        "parent_workspace_id": parent_workspace_id,
        "workspace_type": workspace_type,
        "is_global": is_global,
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
            logger.exception(
                "Failed to clean up partially created workspace | workspace_id=%s",
                workspace_id,
            )


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
            workspace_type="sub",
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
    parent_access = await require_workspace_owner(parent_workspace_id, user_id)
    if not is_super_workspace(parent_access.workspace):
        raise _workspace_validation_error("Subspaces can only be created under a super workspace.")
    return parent_access


async def create_subspace_for_user(
    *,
    user_id: str,
    parent_workspace_id: str | None,
    name: str,
    description: str | None = None,
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
            workspace_type="sub",
            parent_workspace_id=parent_workspace_id,
            is_global=False,
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
    workspace_type: Any = "workspace",
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

    if normalized_type == "sub":
        return await create_subspace_for_user(
            user_id=user_id,
            parent_workspace_id=parent_workspace_id,
            name=name,
            description=description,
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

        if normalized_type == "super":
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

    subspaces = [normalize_workspace_record(row) for row in rows]
    subspaces.sort(key=lambda item: (not bool(item.get("is_global")), item.get("created_at") or ""))
    return subspaces


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

    if workspace_type == "super" and parent_workspace_id:
        errors.append("Super workspaces cannot have a parent workspace.")
    if workspace_type == "workspace" and parent_workspace_id:
        errors.append("Flat workspaces cannot have a parent workspace.")
    if workspace.get("is_global") and workspace_type != "sub":
        errors.append("Only subspaces can be marked global.")
    if parent_workspace_id and str(parent_workspace_id) == str(workspace["id"]):
        errors.append("A workspace cannot be its own parent.")

    if workspace_type == "sub":
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
