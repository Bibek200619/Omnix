from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from ..schemas.chat import (
    WorkspaceCreate,
    WorkspaceInviteCreate,
    WorkspaceInviteRead,
    WorkspaceMemberRead,
    WorkspaceRead,
    WorkspaceUpdate,
)
from ..services.supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_one,
    insert_one_trusted,
    select_one_trusted,
    update_one_trusted,
)
from ..services.workspace_service import (
    WORKSPACE_COLUMNS,
    WORKSPACE_INVITE_COLUMNS,
    hydrate_invites,
    list_pending_invites_for_email,
    list_user_workspaces,
    list_workspace_invites,
    list_workspace_members,
    normalize_email,
    require_workspace_access,
    require_workspace_owner,
    resolve_workspace_access,
    user_email_from_claims,
    utc_now_iso,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


async def _enriched_workspace_for_user(
    workspace_id: str,
    user_id: str,
) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    members = await list_workspace_members(access.workspace)
    return {
        **access.workspace,
        "current_user_role": access.role,
        "member_count": len(members),
        "is_shared": len(members) > 1,
        "members_preview": members[:3],
    }


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    workspace_payload: WorkspaceCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    timestamp = utc_now_iso()
    payload = {
        "user_id": user_id,
        "updated_at": timestamp,
        **workspace_payload.model_dump(exclude_none=True),
    }

    try:
        workspace = await insert_one("workspaces", payload)
        await insert_one(
            "workspace_members",
            {
                "workspace_id": workspace["id"],
                "user_id": user_id,
                "role": "owner",
                "created_at": timestamp,
                "updated_at": timestamp,
            },
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to create workspace")
        raise _database_error() from exc

    return await _enriched_workspace_for_user(str(workspace["id"]), user_id)


@router.get("/invites/pending", response_model=list[WorkspaceInviteRead])
async def get_pending_workspace_invites(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_email = user_email_from_claims(current_user)
    if user_email is None:
        return []
    try:
        return await list_pending_invites_for_email(user_email)
    except Exception as exc:
        logger.exception("Failed to fetch pending invites; returning empty list instead of 500.")
        return []


@router.post("/invites/{invite_id}/accept", response_model=WorkspaceRead)
async def accept_workspace_invite(
    invite_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    user_email = user_email_from_claims(current_user)
    if user_email is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your account is missing an email address.",
        )

    try:
        invite = await select_one_trusted(
            "workspace_invites",
            WORKSPACE_INVITE_COLUMNS,
            {"id": invite_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if invite is None or normalize_email(str(invite.get("email") or "")) != user_email:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found.",
        )

    if invite.get("status") != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite is no longer pending.",
        )

    workspace_id = str(invite["workspace_id"])
    timestamp = utc_now_iso()

    try:
        workspace = await select_one_trusted("workspaces", WORKSPACE_COLUMNS, {"id": workspace_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found.",
        )

    access = await resolve_workspace_access(workspace_id, user_id)
    if access is None:
        try:
            await insert_one(
                "workspace_members",
                {
                    "workspace_id": workspace_id,
                    "user_id": user_id,
                    "role": "member",
                    "created_at": timestamp,
                    "updated_at": timestamp,
                },
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc

    try:
        await update_one_trusted(
            "workspace_invites",
            {"id": invite_id},
            {
                "status": "accepted",
                "accepted_by_user_id": user_id,
                "accepted_at": timestamp,
                "updated_at": timestamp,
            },
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return await _enriched_workspace_for_user(workspace_id, user_id)


@router.post("/invites/{invite_id}/decline", response_model=WorkspaceInviteRead)
async def decline_workspace_invite(
    invite_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_email = user_email_from_claims(current_user)
    if user_email is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your account is missing an email address.",
        )

    try:
        invite = await select_one_trusted(
            "workspace_invites",
            WORKSPACE_INVITE_COLUMNS,
            {"id": invite_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if invite is None or normalize_email(str(invite.get("email") or "")) != user_email:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found.",
        )

    if invite.get("status") != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite is no longer pending.",
        )

    try:
        declined = await update_one_trusted(
            "workspace_invites",
            {"id": invite_id},
            {"status": "declined", "updated_at": utc_now_iso()},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if declined is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found.",
        )

    hydrated = await hydrate_invites([declined])
    return hydrated[0]


@router.get("", response_model=list[WorkspaceRead])
async def list_workspaces(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    try:
        return await list_user_workspaces(user_id)
    except Exception:
        logger.exception("Failed to list user workspaces; returning empty list instead of 500.")
        return []


@router.get("/{workspace_id}", response_model=WorkspaceRead)
async def get_workspace(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await _enriched_workspace_for_user(workspace_id, user_id)


@router.patch("/{workspace_id}", response_model=WorkspaceRead)
async def update_workspace(
    workspace_id: str,
    workspace_payload: WorkspaceUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    await require_workspace_owner(workspace_id, user_id)

    payload = workspace_payload.model_dump(exclude_none=True)
    if "name" in payload:
        payload["name"] = str(payload["name"]).strip()
        if not payload["name"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Workspace name cannot be empty.",
            )

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No updatable fields were provided.",
        )

    payload["updated_at"] = utc_now_iso()

    try:
        updated_workspace = await update_one_trusted(
            "workspaces",
            {"id": workspace_id},
            payload,
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to update workspace")
        raise _database_error() from exc

    if updated_workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found.",
        )

    return await _enriched_workspace_for_user(workspace_id, user_id)


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberRead])
async def get_workspace_members(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_access(workspace_id, user_id)
    return await list_workspace_members(access.workspace)


@router.post("/{workspace_id}/invites", response_model=WorkspaceInviteRead, status_code=status.HTTP_201_CREATED)
async def invite_workspace_member(
    workspace_id: str,
    invite_payload: WorkspaceInviteCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    current_user_email = user_email_from_claims(current_user)
    access = await require_workspace_owner(workspace_id, user_id)

    normalized_email = normalize_email(invite_payload.email)
    if current_user_email and normalized_email == current_user_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already belong to this workspace.",
        )

    members = await list_workspace_members(access.workspace)
    member_emails = {
        normalize_email(member["email"])
        for member in members
        if isinstance(member.get("email"), str) and member["email"]
    }
    if normalized_email in member_emails:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That teammate is already in the workspace.",
        )

    try:
        existing_invite = await select_one_trusted(
            "workspace_invites",
            WORKSPACE_INVITE_COLUMNS,
            {"workspace_id": workspace_id, "email": normalized_email, "status": "pending"},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if existing_invite is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pending invite already exists for that email address.",
        )

    timestamp = utc_now_iso()

    try:
        created = await insert_one_trusted(
            "workspace_invites",
            {
                "workspace_id": workspace_id,
                "email": normalized_email,
                "role": "member",
                "status": "pending",
                "invited_by_user_id": user_id,
                "created_at": timestamp,
                "updated_at": timestamp,
            },
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to create workspace invite")
        raise _database_error() from exc

    hydrated = await hydrate_invites([created])
    return hydrated[0]


@router.get("/{workspace_id}/invites", response_model=list[WorkspaceInviteRead])
async def get_workspace_invites(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    await require_workspace_owner(workspace_id, user_id)
    return await list_workspace_invites(workspace_id)


@router.delete("/{workspace_id}/members/{member_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_workspace_member(
    workspace_id: str,
    member_user_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_owner(workspace_id, user_id)

    if str(access.workspace.get("user_id") or "") == member_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The workspace owner cannot be removed.",
        )

    try:
        membership = await select_one_trusted(
            "workspace_members",
            "workspace_id,user_id,role",
            {"workspace_id": workspace_id, "user_id": member_user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace member not found.",
        )

    try:
        await delete_many_trusted(
            "workspace_members",
            {"workspace_id": workspace_id, "user_id": member_user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return None


@router.delete("/{workspace_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_workspace_invite(
    workspace_id: str,
    invite_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    await require_workspace_owner(workspace_id, user_id)

    try:
        invite = await select_one_trusted(
            "workspace_invites",
            WORKSPACE_INVITE_COLUMNS,
            {"id": invite_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found.",
        )

    if invite.get("status") != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only pending invites can be revoked.",
        )

    try:
        await update_one_trusted(
            "workspace_invites",
            {"id": invite_id},
            {"status": "revoked", "updated_at": utc_now_iso()},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return None


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    await require_workspace_owner(workspace_id, user_id)

    try:
        await delete_many_trusted("workspaces", {"id": workspace_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to delete workspace")
        raise _database_error() from exc

    return None
