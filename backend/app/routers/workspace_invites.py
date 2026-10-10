from __future__ import annotations

from collections.abc import Mapping
import logging
import reprlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from ..db.supabase_client import get_async_supabase
from ..schemas.chat import WorkspaceInviteCreate, WorkspaceInviteRead, WorkspaceRead
from ..services.email_service import send_workspace_invite_email
from ..services.profile_service import get_auth_profile_for_user, resolve_profile_by_username
from ..services.supabase_service import (
    SupabaseServiceError,
    insert_one_trusted,
    select_one_trusted,
    update_one_trusted,
)
from ..services.workspace_collaboration_service import log_workspace_activity
from ..services.workspace_service import (
    WORKSPACE_INVITE_COLUMNS,
    hydrate_invites,
    list_pending_invites_for_email,
    list_workspace_invites,
    list_workspace_members,
    normalize_email,
    normalize_workspace_record,
    normalize_workspace_role,
    require_workspace_access,
    require_workspace_management_access,
    user_email_from_claims,
    utc_now_iso,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspace-invites", tags=["workspace-invites"])
workspace_router = APIRouter(prefix="/workspaces", tags=["workspace-invites"])
ATOMIC_INVITE_ACCEPTANCE_RPC = "accept_workspace_invite_atomic"
INVITE_TRANSITION_LOCATOR_COLUMNS = "id,workspace_id,email,status"


def _safe_current_user_repr(current_user: Any) -> str:
    def redact(value: Mapping[str, Any]) -> dict[str, Any]:
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if any(marker in key_text for marker in ("authorization", "password", "secret", "token", "email")):
                redacted[str(key)] = "***REDACTED***"
            else:
                redacted[str(key)] = item
        return redacted

    try:
        if isinstance(current_user, Mapping):
            debug_value: Any = redact(current_user)
        elif hasattr(current_user, "model_dump"):
            dumped = current_user.model_dump()
            debug_value = redact(dumped) if isinstance(dumped, Mapping) else dumped
        elif hasattr(current_user, "__dict__"):
            debug_value = redact(vars(current_user))
        else:
            debug_value = current_user
        return reprlib.repr(debug_value)
    except Exception:
        return f"<unrepresentable current_user type={type(current_user).__name__}>"


def _resolve_authenticated_user_id(current_user: Any) -> str | None:
    for key in ("id", "user_id", "sub"):
        value = (
            current_user.get(key)
            if isinstance(current_user, Mapping)
            else getattr(current_user, key, None)
        )
        if value is None:
            continue

        user_id = str(value).strip()
        if user_id and user_id.lower() != "none":
            return user_id

    return None


def _user_id_from_claims(current_user: Any) -> str:
    user_id = _resolve_authenticated_user_id(current_user)
    if user_id is None:
        logger.error(
            "Unable to resolve authenticated user id | current_user_type=%r | current_user=%s",
            type(current_user),
            _safe_current_user_repr(current_user),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to resolve authenticated user",
        )
    return user_id


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


def _inviter_label(current_user: Any) -> str:
    metadata = (
        current_user.get("user_metadata", {})
        if isinstance(current_user, Mapping)
        else getattr(current_user, "user_metadata", {})
    )
    name = None
    if isinstance(metadata, Mapping):
        name = metadata.get("full_name") or metadata.get("name")
    email = user_email_from_claims(current_user)
    if isinstance(name, str) and name.strip():
        return f"{name.strip()} ({email})" if email else name.strip()
    return email or "A teammate"


def _email_log_domain(email: str | None) -> str:
    if not email or "@" not in email:
        return "unknown"
    return email.rsplit("@", 1)[-1] or "unknown"


def _membership_workspace(access: Any) -> dict[str, Any]:
    membership_workspace = getattr(access, "membership_workspace", None)
    if isinstance(membership_workspace, Mapping):
        return dict(membership_workspace)
    workspace = getattr(access, "workspace", {})
    return dict(workspace) if isinstance(workspace, Mapping) else {}


def _membership_workspace_id(access: Any) -> str:
    membership_workspace_id = getattr(access, "membership_workspace_id", None)
    if membership_workspace_id:
        return str(membership_workspace_id)
    workspace = _membership_workspace(access)
    return str(workspace.get("id") or "")


def _is_unique_constraint_error(exc: SupabaseServiceError) -> bool:
    root_error = exc.__cause__ or exc
    message = str(root_error).lower()
    return (
        "duplicate key" in message
        or "unique constraint" in message
        or "violates unique" in message
        or "23505" in message
    )


async def _enriched_workspace_for_user(
    workspace_id: str,
    user_id: str,
) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    members = await list_workspace_members(access.workspace)
    return {
        **normalize_workspace_record(access.workspace),
        "current_user_role": access.role,
        "member_count": len(members),
        "is_shared": len(members) > 1,
        "members_preview": members[:3],
    }


async def _insert_workspace_invite(
    *,
    workspace_id: str,
    email: str,
    role: str,
    inviter_user_id: str,
    timestamp: str,
) -> dict[str, Any]:
    base_payload = {
        "workspace_id": workspace_id,
        "email": email,
        "role": normalize_workspace_role(role),
        "status": "pending",
        "invited_by": inviter_user_id,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    return await insert_one_trusted("workspace_invites", base_payload)


async def _pending_workspace_invites_for_user(current_user: Any) -> list[dict[str, Any]]:
    user_email = user_email_from_claims(current_user)
    if user_email is None:
        logger.info("Workspace invite fetch skipped | reason=missing_authenticated_email")
        return []

    try:
        invites = await list_pending_invites_for_email(user_email)
        logger.info(
            "Workspace invite fetch completed | email_domain=%s | count=%d",
            _email_log_domain(user_email),
            len(invites),
        )
        return invites
    except Exception:
        logger.exception(
            "Failed to fetch pending workspace invites; returning empty list instead of 500 | email_domain=%s",
            _email_log_domain(user_email),
        )
        return []


async def _accept_workspace_invite_rpc(
    invite_id: str,
    user_id: str,
    user_email: str,
) -> dict[str, Any]:
    try:
        client = await get_async_supabase()
        response = await client.rpc(
            ATOMIC_INVITE_ACCEPTANCE_RPC,
            {
                "p_invite_id": invite_id,
                "p_user_id": user_id,
                "p_email": user_email,
            },
        ).execute()
    except Exception:
        raise SupabaseServiceError("Internal server error") from None

    data = getattr(response, "data", None)
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], dict):
        return dict(data[0])
    if isinstance(data, dict):
        return dict(data)
    raise SupabaseServiceError("Internal server error")


async def _accept_workspace_invite(invite_id: str, current_user: Any) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    user_email = user_email_from_claims(current_user)
    if user_email is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your account is missing an email address.",
        )
    logger.info(
        "Workspace invite accept requested | invite_id=%s | email_domain=%s",
        invite_id,
        _email_log_domain(user_email),
    )

    try:
        result = await _accept_workspace_invite_rpc(
            invite_id,
            user_id,
            normalize_email(user_email),
        )
    except SupabaseServiceError:
        logger.error(
            "Atomic workspace invite acceptance failed | invite_id=%s", invite_id
        )
        raise _database_error() from None

    outcome = str(result.get("outcome") or "")
    if outcome == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found.",
        )
    if outcome == "not_pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite is no longer pending.",
        )
    if outcome == "workspace_not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found.",
        )
    workspace_id = str(result.get("accepted_workspace_id") or "")
    if outcome != "accepted" or not workspace_id:
        logger.error(
            "Atomic workspace invite acceptance returned an invalid outcome | invite_id=%s",
            invite_id,
        )
        raise _database_error()

    membership_created = bool(result.get("membership_created"))

    logger.info(
        "Workspace invite accepted | invite_id=%s | workspace_id=%s | membership_created=%s",
        invite_id,
        workspace_id,
        membership_created,
    )
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="workspace.member_joined",
        summary="A teammate joined the workspace.",
        metadata={"invite_id": invite_id, "membership_created": membership_created},
    )
    return await _enriched_workspace_for_user(workspace_id, user_id)


async def _decline_workspace_invite(
    invite_id: str, current_user: Any
) -> dict[str, Any]:
    user_email = user_email_from_claims(current_user)
    if user_email is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your account is missing an email address.",
        )
    logger.info(
        "Workspace invite decline requested | invite_id=%s | email_domain=%s",
        invite_id,
        _email_log_domain(user_email),
    )

    try:
        invite = await select_one_trusted(
            "workspace_invites",
            INVITE_TRANSITION_LOCATOR_COLUMNS,
            {"id": invite_id, "email": user_email},
        )
    except SupabaseServiceError as exc:
        logger.exception(
            "Failed to load workspace invite for decline | invite_id=%s", invite_id
        )
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
            {
                "id": invite_id,
                "workspace_id": str(invite["workspace_id"]),
                "email": str(invite["email"]),
                "status": "pending",
            },
            {"status": "declined", "updated_at": utc_now_iso()},
        )
    except SupabaseServiceError as exc:
        logger.exception(
            "Failed to mark workspace invite declined | invite_id=%s", invite_id
        )
        raise _database_error() from exc

    if declined is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite is no longer pending.",
        )

    hydrated = await hydrate_invites([declined])
    logger.info("Workspace invite declined | invite_id=%s", invite_id)
    return hydrated[0]


@router.get("", response_model=list[WorkspaceInviteRead])
async def list_authenticated_workspace_invites(
    current_user: Any = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await _pending_workspace_invites_for_user(current_user)


@router.post("/{invite_id}/accept", response_model=WorkspaceRead)
async def accept_authenticated_workspace_invite(
    invite_id: str,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return await _accept_workspace_invite(invite_id, current_user)


@router.post("/{invite_id}/decline", response_model=WorkspaceInviteRead)
async def decline_authenticated_workspace_invite(
    invite_id: str,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return await _decline_workspace_invite(invite_id, current_user)


@workspace_router.get("/invites/pending", response_model=list[WorkspaceInviteRead])
async def get_pending_workspace_invites(
    current_user: Any = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await _pending_workspace_invites_for_user(current_user)


@workspace_router.post("/invites/{invite_id}/accept", response_model=WorkspaceRead)
async def accept_workspace_invite(
    invite_id: str,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return await _accept_workspace_invite(invite_id, current_user)


@workspace_router.post("/invites/{invite_id}/decline", response_model=WorkspaceInviteRead)
async def decline_workspace_invite(
    invite_id: str,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return await _decline_workspace_invite(invite_id, current_user)


@workspace_router.post("/{workspace_id}/invites", response_model=WorkspaceInviteRead, status_code=status.HTTP_201_CREATED)
async def invite_workspace_member(
    workspace_id: str,
    invite_payload: WorkspaceInviteCreate,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    current_user_email = user_email_from_claims(current_user)
    access = await require_workspace_management_access(workspace_id, user_id)
    membership_workspace = _membership_workspace(access)
    membership_workspace_id = _membership_workspace_id(access)

    raw_invite_target = invite_payload.email.strip()
    requested_role = normalize_workspace_role(invite_payload.role)
    if requested_role == "owner":
        requested_role = "co_owner"

    target_profile: dict[str, Any] | None = None
    if "@" in raw_invite_target:
        normalized_email = normalize_email(raw_invite_target)
    else:
        target_profile = await resolve_profile_by_username(raw_invite_target)
        if target_profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No Omnix user with that username was found.",
            )
        auth_profile = await get_auth_profile_for_user(str(target_profile["id"]))
        if not auth_profile.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That Omnix user does not have an email address available for invites.",
            )
        normalized_email = normalize_email(auth_profile.email)

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
            {"workspace_id": membership_workspace_id, "email": normalized_email, "status": "pending"},
        )
    except SupabaseServiceError as exc:
        logger.exception(
            "Failed to check existing workspace invite | workspace_id=%s | invited_email_domain=%s | root_error=%r",
            workspace_id,
            _email_log_domain(normalized_email),
            exc.__cause__ or exc,
        )
        raise _database_error() from exc

    if existing_invite is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pending invite already exists for that email address.",
        )

    timestamp = utc_now_iso()

    try:
        logger.info(
            "Workspace invite create requested | workspace_id=%s | invited_email_domain=%s | inviter_user_id=%s",
            membership_workspace_id,
            _email_log_domain(normalized_email),
            user_id,
        )
        created = await _insert_workspace_invite(
            workspace_id=membership_workspace_id,
            email=normalized_email,
            role=requested_role,
            inviter_user_id=user_id,
            timestamp=timestamp,
        )
    except SupabaseServiceError as exc:
        if _is_unique_constraint_error(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A pending invite already exists for that email address.",
            ) from exc
        logger.exception(
            "Failed to create workspace invite | workspace_id=%s | invited_email_domain=%s | invited_by=%s | root_error=%r",
            membership_workspace_id,
            _email_log_domain(normalized_email),
            user_id,
            exc.__cause__ or exc,
        )
        raise _database_error() from exc

    hydrated = await hydrate_invites([created])
    invite_id = str(created.get("id") or "")
    if invite_id:
        email_result = await send_workspace_invite_email(
            to_email=normalized_email,
            workspace_name=str(membership_workspace.get("name") or access.workspace.get("name") or "Omnix workspace"),
            inviter_label=_inviter_label(current_user),
            invite_id=invite_id,
        )
        logger.info(
            "Workspace invite email delivery result | invite_id=%s | status=%s | provider_id=%s",
            invite_id,
            email_result.status,
            email_result.provider_id,
        )

    await log_workspace_activity(
        workspace_id=membership_workspace_id,
        actor_user_id=user_id,
        event_type="workspace.invite_created",
        summary="A workspace invite was created.",
        metadata={"role": requested_role, "invite_id": invite_id},
    )
    return hydrated[0]


@workspace_router.get("/{workspace_id}/invites", response_model=list[WorkspaceInviteRead])
async def get_workspace_invites(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_management_access(workspace_id, user_id)
    return await list_workspace_invites(_membership_workspace_id(access))


@workspace_router.delete(
    "/{workspace_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def revoke_workspace_invite(
    workspace_id: str,
    invite_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_management_access(workspace_id, user_id)
    membership_workspace_id = _membership_workspace_id(access)

    try:
        invite = await select_one_trusted(
            "workspace_invites",
            INVITE_TRANSITION_LOCATOR_COLUMNS,
            {"id": invite_id, "workspace_id": membership_workspace_id},
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
        revoked = await update_one_trusted(
            "workspace_invites",
            {
                "id": invite_id,
                "workspace_id": membership_workspace_id,
                "status": "pending",
            },
            {"status": "revoked", "updated_at": utc_now_iso()},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if revoked is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite is no longer pending.",
        )

    await log_workspace_activity(
        workspace_id=membership_workspace_id,
        actor_user_id=user_id,
        event_type="workspace.invite_revoked",
        summary="A workspace invite was revoked.",
        metadata={"invite_id": invite_id},
    )
    return None
