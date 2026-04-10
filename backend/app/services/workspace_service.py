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
    select_all,
    select_all_trusted,
    select_one_trusted,
)
from .profile_service import get_user_profile_map

logger = logging.getLogger(__name__)

WORKSPACE_COLUMNS = "id,user_id,name,description,created_at,updated_at"
WORKSPACE_MEMBER_COLUMNS = "workspace_id,user_id,role,created_at,updated_at"
WORKSPACE_INVITE_COLUMNS = (
    "id,workspace_id,email,role,status,invited_by,accepted_by_user_id,"
    "created_at,updated_at,accepted_at"
)
MEMBERS_PREVIEW_LIMIT = 3

WorkspaceRole = Literal["founder", "co_owner", "member"]
WorkspaceInviteStatus = Literal["pending", "accepted", "declined", "revoked"]


@dataclass(slots=True)
class WorkspaceAccess:
    workspace: dict[str, Any]
    role: WorkspaceRole

    @property
    def workspace_id(self) -> str:
        return str(self.workspace["id"])

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

    owner_user_id = str(workspace.get("user_id") or "")
    if owner_user_id == user_id:
        return WorkspaceAccess(workspace=workspace, role="founder")

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
    return WorkspaceAccess(workspace=workspace, role=role)


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
) -> list[dict[str, Any]]:
    owner_user_id = str(workspace.get("user_id") or "")
    member_map: dict[str, dict[str, Any]] = {
        str(row.get("user_id")): row
        for row in member_rows
        if row.get("user_id")
    }

    if owner_user_id and owner_user_id not in member_map:
        member_map[owner_user_id] = {
            "workspace_id": workspace.get("id"),
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
                "workspace_id": str(row.get("workspace_id") or workspace.get("id")),
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


async def list_workspace_members(
    workspace: dict[str, Any],
) -> list[dict[str, Any]]:
    workspace_id = str(workspace["id"])

    try:
        member_rows = await select_all_trusted(
            "workspace_members",
            WORKSPACE_MEMBER_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="created_at",
            desc=False,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    user_ids = [str(workspace.get("user_id") or "")]
    user_ids.extend(str(row.get("user_id") or "") for row in member_rows)
    profiles = await get_profiles(user_ids)
    return _hydrate_member_records(workspace, member_rows, profiles)


async def list_user_workspaces(user_id: str) -> list[dict[str, Any]]:
    try:
        owned_workspaces = await select_all(
            "workspaces",
            WORKSPACE_COLUMNS,
            filters={"user_id": user_id},
            order_by="created_at",
            desc=False,
        )
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
            await select_all_trusted(
                "workspaces",
                WORKSPACE_COLUMNS,
                filters={"id": shared_workspace_ids},
                order_by="created_at",
                desc=False,
            )
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

    workspaces = list(workspace_by_id.values())
    workspace_ids = [str(workspace["id"]) for workspace in workspaces]

    try:
        all_member_rows = (
            await select_all_trusted(
                "workspace_members",
                WORKSPACE_MEMBER_COLUMNS,
                filters={"workspace_id": workspace_ids},
                order_by="created_at",
                desc=False,
            )
            if workspace_ids
            else []
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    member_rows_by_workspace_id: dict[str, list[dict[str, Any]]] = {}
    user_ids: list[str] = []

    for workspace in workspaces:
        user_ids.append(str(workspace.get("user_id") or ""))

    for row in all_member_rows:
        workspace_id = str(row.get("workspace_id") or "")
        member_rows_by_workspace_id.setdefault(workspace_id, []).append(row)
        user_ids.append(str(row.get("user_id") or ""))

    profiles = await get_profiles(user_ids)

    enriched: list[dict[str, Any]] = []
    for workspace in workspaces:
        workspace_id = str(workspace["id"])
        members = _hydrate_member_records(
            workspace,
            member_rows_by_workspace_id.get(workspace_id, []),
            profiles,
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
