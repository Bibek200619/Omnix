from __future__ import annotations

from typing import Any
import logging

from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..db.supabase_client import get_supabase
from .profile_service import get_user_profile_map
from .supabase_service import SupabaseServiceError, insert_one, select_all_trusted, select_one_trusted
from .workspace_common import (
    WORKSPACE_MEMBER_COLUMNS,
    database_error,
    is_subspace,
    is_super_workspace,
    normalize_operational_label,
    normalize_workspace_record,
    normalize_workspace_role,
    utc_now_iso,
    workspace_validation_error,
)
from .workspace_permissions import OrganizationalAccessAuthority

logger = logging.getLogger(__name__)


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


def hydrate_member_records(
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
                "operational_label": normalize_operational_label(row.get("operational_label")),
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
    from .workspace_service import _select_workspace_record

    normalized = normalize_workspace_record(workspace)
    parent_workspace_id = normalized.get("parent_workspace_id")
    if not parent_workspace_id:
        return normalized

    if not normalized.get("is_global"):
        return normalized

    parent_workspace = await _select_workspace_record({"id": str(parent_workspace_id)})

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
        raise database_error() from exc

    user_ids = [str(membership_workspace.get("user_id") or "")]
    user_ids.extend(str(row.get("user_id") or "") for row in member_rows)
    profiles = await get_profiles(user_ids)
    return hydrate_member_records(
        membership_workspace,
        member_rows,
        profiles,
        response_workspace_id=str(requested_workspace["id"]),
    )


async def list_potential_subspace_members(
    workspace_id: str,
    user_id: str,
) -> list[dict[str, Any]]:
    from .workspace_service import _select_workspace_record, require_workspace_management_access

    access = await require_workspace_management_access(workspace_id, user_id)
    workspace = normalize_workspace_record(access.workspace)

    if not is_subspace(workspace) or not workspace.get("parent_workspace_id"):
        raise workspace_validation_error("Potential members can only be listed for subspaces.")

    parent_workspace_id = str(workspace["parent_workspace_id"])

    try:
        parent_members = await select_all_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            filters={"workspace_id": parent_workspace_id},
        )
        current_members = await select_all_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            filters={"workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise database_error() from exc

    current_user_ids = {str(member["user_id"]) for member in current_members}
    potential_user_ids = [
        str(member["user_id"])
        for member in parent_members
        if str(member["user_id"]) not in current_user_ids
    ]

    parent_workspace = await _select_workspace_record({"id": parent_workspace_id})
    if parent_workspace:
        parent_owner_id = str(parent_workspace.get("user_id") or "")
        if parent_owner_id and parent_owner_id not in current_user_ids:
            if parent_owner_id not in potential_user_ids:
                potential_user_ids.append(parent_owner_id)

    if not potential_user_ids:
        return []

    profiles = await get_profiles(list(set(potential_user_ids)))

    results = []
    for user_id_value in potential_user_ids:
        profile = profiles.get(user_id_value, {})
        results.append(
            {
                "user_id": user_id_value,
                "email": profile.get("email"),
                "full_name": profile.get("full_name"),
                "handle": profile.get("handle"),
                "avatar_url": profile.get("avatar_url"),
                "avatar_label": profile.get("avatar_label") or "U",
            }
        )

    results.sort(key=lambda item: (item.get("full_name") or item.get("email") or item["user_id"]).lower())
    return results


async def assign_member_to_subspace(
    workspace_id: str,
    target_user_id: str,
    role: str,
    actor_user_id: str,
) -> dict[str, Any]:
    from .workspace_service import require_workspace_management_access

    access = await require_workspace_management_access(workspace_id, actor_user_id)
    workspace = normalize_workspace_record(access.workspace)
    workspace_type = workspace.get("workspace_type") or "subworkspace"

    if not is_subspace(workspace) or not workspace.get("parent_workspace_id"):
        raise workspace_validation_error("Members can only be assigned to subspaces.")

    if not OrganizationalAccessAuthority.can_manage_members(access.role, workspace_type):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to assign members.",
        )

    next_role = normalize_workspace_role(role)
    if next_role == "founder":
        raise workspace_validation_error("Founder role cannot be assigned.")

    if next_role != "member" and not OrganizationalAccessAuthority.can_assign_leaders(access.role, workspace_type):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to assign leadership roles in this subspace.",
        )

    parent_workspace_id = str(workspace["parent_workspace_id"])

    try:
        org_membership = await select_one_trusted(
            "workspace_members",
            "user_id",
            {"workspace_id": parent_workspace_id, "user_id": target_user_id},
        )
        if not org_membership:
            parent_workspace = await select_one_trusted("workspaces", "user_id", {"id": parent_workspace_id})
            if not parent_workspace or str(parent_workspace.get("user_id")) != target_user_id:
                raise workspace_validation_error("Target user does not belong to the organization.")
    except SupabaseServiceError as exc:
        raise database_error() from exc

    try:
        existing = await select_one_trusted(
            "workspace_members",
            "user_id",
            {"workspace_id": workspace_id, "user_id": target_user_id},
        )
        if existing:
            raise workspace_validation_error("User is already a member of this subspace.")
    except SupabaseServiceError as exc:
        raise database_error() from exc

    timestamp = utc_now_iso()
    try:
        await insert_one(
            "workspace_members",
            {
                "workspace_id": workspace_id,
                "user_id": target_user_id,
                "role": next_role,
                "created_at": timestamp,
                "updated_at": timestamp,
            },
        )
    except SupabaseServiceError as exc:
        raise database_error() from exc

    profiles = await get_profiles([target_user_id])
    profile = profiles.get(target_user_id, {})

    return {
        "workspace_id": workspace_id,
        "user_id": target_user_id,
        "role": next_role,
        "email": profile.get("email"),
        "full_name": profile.get("full_name"),
        "handle": profile.get("handle"),
        "avatar_url": profile.get("avatar_url"),
        "avatar_label": profile.get("avatar_label") or "U",
        "operational_label": None,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
