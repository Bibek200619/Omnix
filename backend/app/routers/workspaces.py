from __future__ import annotations

from collections.abc import Mapping
import logging
import reprlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from ..schemas.chat import (
    WorkspaceCreate,
    WorkspaceInviteCreate,
    WorkspaceInviteRead,
    WorkspaceActivityRead,
    WorkspaceIntelligenceRead,
    WorkspaceIntelligenceUpdate,
    WorkspaceLiveStatusRead,
    WorkspaceMemberRead,
    WorkspaceMemberRoleUpdate,
    WorkspaceMemberAssign,
    WorkspacePotentialMemberRead,
    WorkspacePresenceHeartbeat,
    WorkspacePresenceRead,
    WorkspaceRead,
    WorkspaceRelationshipValidation,
    WorkspaceSubspaceCreate,
    WorkspaceTypingUpdate,
    WorkspaceTreeRead,
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
from ..services.email_service import send_workspace_invite_email
from ..services.profile_service import get_auth_profile_for_user, resolve_profile_by_username
from ..services.workspace_service import (
    WORKSPACE_COLUMNS,
    WORKSPACE_INVITE_COLUMNS,
    assign_member_to_subspace,
    create_subspace_for_user,
    create_workspace_for_user,
    get_global_space_for_super_workspace,
    hydrate_invites,
    is_super_workspace,
    is_subspace,
    list_pending_invites_for_email,
    list_potential_subspace_members,
    list_subspaces_for_super_workspace,
    list_user_workspaces,
    list_workspace_invites,
    list_workspace_members,
    normalize_workspace_record,
    normalize_email,
    normalize_workspace_role,
    require_workspace_access,
    require_workspace_management_access,
    resolve_workspace_access,
    user_email_from_claims,
    utc_now_iso,
    validate_workspace_relationship,
)
from ..services.workspace_intelligence_service import build_workspace_intelligence_profile
from ..services.workspace_collaboration_service import (
    heartbeat_workspace_presence,
    leave_workspace_presence,
    list_workspace_activity,
    list_workspace_live_statuses,
    list_workspace_presence,
    log_workspace_activity,
    update_workspace_typing,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])
invite_router = APIRouter(prefix="/workspace-invites", tags=["workspace-invites"])


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


def _is_missing_supabase_column(exc: SupabaseServiceError, column: str) -> bool:
    root_error = exc.__cause__ or exc
    message = str(root_error).lower()
    normalized_column = column.lower()
    return normalized_column in message and (
        "could not find" in message
        or "does not exist" in message
        or "schema cache" in message
    )


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


async def _enriched_workspace_from_record(
    workspace: dict[str, Any],
    user_id: str,
) -> dict[str, Any]:
    return await _enriched_workspace_for_user(str(workspace["id"]), user_id)


async def _workspace_tree_for_user(
    workspace_id: str,
    user_id: str,
) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    root_workspace = normalize_workspace_record(access.workspace)
    if is_subspace(root_workspace) and root_workspace.get("parent_workspace_id"):
        parent_access = await require_workspace_access(str(root_workspace["parent_workspace_id"]), user_id)
        root_workspace = normalize_workspace_record(parent_access.workspace)

    root = await _enriched_workspace_from_record(root_workspace, user_id)
    subspaces = (
        await list_subspaces_for_super_workspace(str(root_workspace["id"]), user_id)
        if is_super_workspace(root_workspace)
        else []
    )
    root["subspaces"] = [
        await _enriched_workspace_from_record(subspace, user_id)
        for subspace in subspaces
    ]
    return root


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
        invite = await select_one_trusted(
            "workspace_invites",
            WORKSPACE_INVITE_COLUMNS,
            {"id": invite_id},
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to load workspace invite for accept | invite_id=%s", invite_id)
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
        logger.exception("Failed to load workspace for invite accept | workspace_id=%s", workspace_id)
        raise _database_error() from exc

    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found.",
        )

    access = await resolve_workspace_access(workspace_id, user_id)
    membership_created = False
    if access is None:
        invite_role = normalize_workspace_role(invite.get("role"))
        if invite_role == "owner":
            invite_role = "co_owner"
        try:
            await insert_one(
                "workspace_members",
                {
                    "workspace_id": workspace_id,
                    "user_id": user_id,
                    "role": invite_role,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                },
            )
            membership_created = True
        except SupabaseServiceError as exc:
            logger.exception(
                "Failed to create workspace membership from invite | workspace_id=%s | user_id=%s",
                workspace_id,
                user_id,
            )
            raise _database_error() from exc

    accept_payload = {
        "status": "accepted",
        "accepted_by_user_id": user_id,
        "accepted_at": timestamp,
        "updated_at": timestamp,
    }
    try:
        await update_one_trusted("workspace_invites", {"id": invite_id}, accept_payload)
    except SupabaseServiceError as exc:
        if _is_missing_supabase_column(exc, "accepted_at"):
            logger.warning(
                "workspace_invites.accepted_at is unavailable; marking invite accepted without accepted_at | invite_id=%s",
                invite_id,
            )
            fallback_payload = {key: value for key, value in accept_payload.items() if key != "accepted_at"}
            try:
                await update_one_trusted("workspace_invites", {"id": invite_id}, fallback_payload)
            except SupabaseServiceError as fallback_exc:
                logger.exception("Failed to mark workspace invite accepted | invite_id=%s", invite_id)
                raise _database_error() from fallback_exc
        else:
            logger.exception("Failed to mark workspace invite accepted | invite_id=%s", invite_id)
            raise _database_error() from exc

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


async def _decline_workspace_invite(invite_id: str, current_user: Any) -> dict[str, Any]:
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
            WORKSPACE_INVITE_COLUMNS,
            {"id": invite_id},
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to load workspace invite for decline | invite_id=%s", invite_id)
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
        logger.exception("Failed to mark workspace invite declined | invite_id=%s", invite_id)
        raise _database_error() from exc

    if declined is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found.",
        )

    hydrated = await hydrate_invites([declined])
    logger.info("Workspace invite declined | invite_id=%s", invite_id)
    return hydrated[0]


@invite_router.get("", response_model=list[WorkspaceInviteRead])
async def list_authenticated_workspace_invites(
    current_user: Any = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await _pending_workspace_invites_for_user(current_user)


@invite_router.post("/{invite_id}/accept", response_model=WorkspaceRead)
async def accept_authenticated_workspace_invite(
    invite_id: str,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return await _accept_workspace_invite(invite_id, current_user)


@invite_router.post("/{invite_id}/decline", response_model=WorkspaceInviteRead)
async def decline_authenticated_workspace_invite(
    invite_id: str,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return await _decline_workspace_invite(invite_id, current_user)


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    workspace_payload: WorkspaceCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)

    try:
        workspace = await create_workspace_for_user(
            user_id=user_id,
            **workspace_payload.model_dump(),
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to create workspace")
        raise _database_error() from exc

    await log_workspace_activity(
        workspace_id=str(workspace["id"]),
        actor_user_id=user_id,
        event_type="workspace.created",
        summary=f"{workspace.get('name') or 'Workspace'} workspace was created.",
        metadata={
            "workspace_type": workspace.get("workspace_type"),
            "is_global": bool(workspace.get("is_global")),
        },
    )
    return await _enriched_workspace_for_user(str(workspace["id"]), user_id)


@router.get("/invites/pending", response_model=list[WorkspaceInviteRead])
async def get_pending_workspace_invites(
    current_user: Any = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await _pending_workspace_invites_for_user(current_user)


@router.post("/invites/{invite_id}/accept", response_model=WorkspaceRead)
async def accept_workspace_invite(
    invite_id: str,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return await _accept_workspace_invite(invite_id, current_user)


@router.post("/invites/{invite_id}/decline", response_model=WorkspaceInviteRead)
async def decline_workspace_invite(
    invite_id: str,
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return await _decline_workspace_invite(invite_id, current_user)


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


@router.get("/hierarchy", response_model=list[WorkspaceTreeRead])
async def get_workspace_hierarchy(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    workspaces = await list_user_workspaces(user_id)
    workspace_by_id = {str(workspace["id"]): workspace for workspace in workspaces}
    subspaces_by_parent_id: dict[str, list[dict[str, Any]]] = {}
    roots: list[dict[str, Any]] = []

    for workspace in workspaces:
        normalized = normalize_workspace_record(workspace)
        parent_workspace_id = normalized.get("parent_workspace_id")
        if parent_workspace_id and parent_workspace_id in workspace_by_id:
            subspaces_by_parent_id.setdefault(str(parent_workspace_id), []).append(normalized)
        else:
            roots.append(normalized)

    hierarchy: list[dict[str, Any]] = []
    for root in roots:
        subspaces = subspaces_by_parent_id.get(str(root["id"]), [])
        subspaces.sort(key=lambda item: (not bool(item.get("is_global")), item.get("created_at") or ""))
        hierarchy.append({**root, "subspaces": subspaces})

    hierarchy.sort(key=lambda item: item.get("created_at") or "")
    return hierarchy


@router.get("/status", response_model=list[WorkspaceLiveStatusRead])
async def get_workspace_live_statuses(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    return await list_workspace_live_statuses(user_id)


@router.get("/{workspace_id}", response_model=WorkspaceRead)
async def get_workspace(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await _enriched_workspace_for_user(workspace_id, user_id)


@router.get("/{workspace_id}/hierarchy", response_model=WorkspaceTreeRead)
async def get_workspace_tree(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await _workspace_tree_for_user(workspace_id, user_id)


@router.get("/{workspace_id}/subspaces", response_model=list[WorkspaceRead])
async def get_workspace_subspaces(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    subspaces = await list_subspaces_for_super_workspace(workspace_id, user_id)
    return [
        await _enriched_workspace_from_record(subspace, user_id)
        for subspace in subspaces
    ]


@router.get("/{workspace_id}/presence", response_model=WorkspacePresenceRead)
async def get_workspace_presence(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await list_workspace_presence(workspace_id=workspace_id, user_id=user_id)


@router.post("/{workspace_id}/presence/heartbeat", response_model=WorkspacePresenceRead)
async def heartbeat_presence(
    workspace_id: str,
    presence_payload: WorkspacePresenceHeartbeat,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await heartbeat_workspace_presence(
        workspace_id=workspace_id,
        user_id=user_id,
        current_view=presence_payload.current_view,
        current_label=presence_payload.current_label,
        metadata=presence_payload.metadata,
    )


@router.delete("/{workspace_id}/presence", status_code=status.HTTP_204_NO_CONTENT)
async def leave_presence(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    await leave_workspace_presence(
        workspace_id=workspace_id,
        user_id=user_id,
    )
    return None


@router.post("/{workspace_id}/presence/typing", response_model=WorkspacePresenceRead)
async def update_typing_presence(
    workspace_id: str,
    typing_payload: WorkspaceTypingUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await update_workspace_typing(
        workspace_id=workspace_id,
        user_id=user_id,
        conversation_id=typing_payload.conversation_id,
        is_typing=typing_payload.is_typing,
    )


@router.get("/{workspace_id}/activity", response_model=list[WorkspaceActivityRead])
async def get_workspace_activity(
    workspace_id: str,
    limit: int = 20,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    bounded_limit = max(1, min(limit, 50))
    return await list_workspace_activity(
        workspace_id=workspace_id,
        user_id=user_id,
        limit=bounded_limit,
    )


@router.post("/{workspace_id}/subspaces", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
async def create_workspace_subspace(
    workspace_id: str,
    subspace_payload: WorkspaceSubspaceCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    try:
        subspace = await create_subspace_for_user(
            user_id=user_id,
            parent_workspace_id=workspace_id,
            **subspace_payload.model_dump(),
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to create subspace")
        raise _database_error() from exc
    await log_workspace_activity(
        workspace_id=str(subspace["id"]),
        actor_user_id=user_id,
        event_type="workspace.subspace_created",
        summary=f"{subspace.get('name') or 'Subworkspace'} subworkspace was created.",
        metadata={"parent_workspace_id": workspace_id},
    )
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="workspace.subspace_created",
        summary=f"{subspace.get('name') or 'Subworkspace'} was added as a subworkspace.",
        metadata={"subspace_id": str(subspace.get("id") or "")},
    )
    return await _enriched_workspace_for_user(str(subspace["id"]), user_id)


@router.get("/{workspace_id}/global", response_model=WorkspaceRead)
async def get_workspace_global_space(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_access(workspace_id, user_id)
    workspace = normalize_workspace_record(access.workspace)
    if not is_super_workspace(workspace):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workspace is not a super workspace.",
        )

    global_space = await get_global_space_for_super_workspace(workspace_id)
    if global_space is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Global space not found.",
        )
    return await _enriched_workspace_for_user(str(global_space["id"]), user_id)


@router.get("/{workspace_id}/relationships/validate", response_model=WorkspaceRelationshipValidation)
async def validate_workspace_relationships(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await validate_workspace_relationship(workspace_id, user_id)


@router.get("/{workspace_id}/intelligence", response_model=WorkspaceIntelligenceRead)
async def get_workspace_intelligence(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await build_workspace_intelligence_profile(workspace_id, user_id)


@router.patch("/{workspace_id}/intelligence", response_model=WorkspaceIntelligenceRead)
async def update_workspace_intelligence(
    workspace_id: str,
    intelligence_payload: WorkspaceIntelligenceUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_management_access(workspace_id, user_id)
    normalized_workspace = normalize_workspace_record(access.workspace)
    payload = intelligence_payload.model_dump()
    payload["expertise_area"] = str(payload.get("expertise_area") or "").strip() or None
    payload["ai_instructions"] = str(payload.get("ai_instructions") or "").strip() or None
    payload["intelligence_preferences"] = {
        **(payload.get("intelligence_preferences") or {}),
        "retrieval_scope": "global" if normalized_workspace.get("is_global") else (payload.get("intelligence_preferences") or {}).get("retrieval_scope", "workspace"),
    }
    payload["updated_at"] = utc_now_iso()

    try:
        updated_workspace = await update_one_trusted(
            "workspaces",
            {"id": workspace_id},
            payload,
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to update workspace intelligence")
        raise _database_error() from exc

    if updated_workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found.",
        )

    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="workspace.intelligence_updated",
        summary="Workspace AI intelligence profile was updated.",
        metadata={
            "ai_specialization": payload.get("ai_specialization"),
            "retrieval_scope": (payload.get("intelligence_preferences") or {}).get("retrieval_scope"),
        },
    )
    return await build_workspace_intelligence_profile(workspace_id, user_id)


@router.patch("/{workspace_id}", response_model=WorkspaceRead)
async def update_workspace(
    workspace_id: str,
    workspace_payload: WorkspaceUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    await require_workspace_management_access(workspace_id, user_id)

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


@router.get("/{workspace_id}/potential-members", response_model=list[WorkspacePotentialMemberRead])
async def get_potential_subspace_members(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    return await list_potential_subspace_members(workspace_id, user_id)


@router.post("/{workspace_id}/members/assign", response_model=WorkspaceMemberRead)
async def assign_subspace_member(
    workspace_id: str,
    payload: WorkspaceMemberAssign,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    member = await assign_member_to_subspace(
        workspace_id=workspace_id,
        target_user_id=payload.user_id,
        role=payload.role,
        actor_user_id=user_id,
    )
    
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="workspace.member_assigned",
        summary="An organizational member was assigned to this subspace.",
        metadata={"target_user_id": payload.user_id, "role": payload.role},
    )
    return member


from app.services.workspace_permissions import OrganizationalAccessAuthority

@router.patch("/{workspace_id}/members/{member_user_id}", response_model=WorkspaceMemberRead)
@router.patch("/{workspace_id}/members/{member_user_id}/", response_model=WorkspaceMemberRead, include_in_schema=False)
async def update_workspace_member_role(
    workspace_id: str,
    member_user_id: str,
    role_payload: WorkspaceMemberRoleUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_access(workspace_id, user_id)
    workspace_type = access.workspace.get("workspace_type") or "workspace"

    if not OrganizationalAccessAuthority.can_assign_leaders(access.role, workspace_type):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage roles in this workspace.",
        )

    membership_workspace = _membership_workspace(access)
    membership_workspace_id = _membership_workspace_id(access)
    founder_user_id = str(membership_workspace.get("user_id") or access.workspace.get("user_id") or "")
    if founder_user_id == member_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The workspace founder role cannot be changed.",
        )

    try:
        membership = await select_one_trusted(
            "workspace_members",
            "workspace_id,user_id,role",
            {"workspace_id": membership_workspace_id, "user_id": member_user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace member not found.",
        )

    next_role = normalize_workspace_role(role_payload.role)
    current_member_role = normalize_workspace_role(
        membership.get("role"),
        member_user_id=member_user_id,
        owner_user_id=founder_user_id,
    )

    if next_role == "founder":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only the original founder can have the founder role.",
        )

    # In the scoped model, subleaders and co-owners cannot escalate their own privileges or demote founders
    if access.role in {"co_owner", "sub_leader"} and (current_member_role not in {"member", "sub_member"} or next_role not in {"member", "sub_member"}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only manage standard members.",
        )

    try:
        await update_one_trusted(
            "workspace_members",
            {"workspace_id": membership_workspace_id, "user_id": member_user_id},
            {"role": next_role, "updated_at": utc_now_iso()},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    await log_workspace_activity(
        workspace_id=membership_workspace_id,
        actor_user_id=user_id,
        event_type="workspace.member_role_updated",
        summary="A workspace member role was updated.",
        metadata={"member_user_id": member_user_id, "role": next_role},
    )
    members = await list_workspace_members(access.workspace)
    for member in members:
        if member.get("user_id") == member_user_id:
            return member

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Workspace member not found.",
    )


@router.post("/{workspace_id}/invites", response_model=WorkspaceInviteRead, status_code=status.HTTP_201_CREATED)
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


@router.get("/{workspace_id}/invites", response_model=list[WorkspaceInviteRead])
async def get_workspace_invites(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_management_access(workspace_id, user_id)
    return await list_workspace_invites(_membership_workspace_id(access))


@router.delete("/{workspace_id}/members/{member_user_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/{workspace_id}/members/{member_user_id}/", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def remove_workspace_member(
    workspace_id: str,
    member_user_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_access(workspace_id, user_id)
    workspace_type = access.workspace.get("workspace_type") or "workspace"

    if not OrganizationalAccessAuthority.can_remove_members(access.role, workspace_type):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to remove members from this workspace.",
        )

    membership_workspace = _membership_workspace(access)
    membership_workspace_id = _membership_workspace_id(access)
    founder_user_id = str(membership_workspace.get("user_id") or access.workspace.get("user_id") or "")
    if founder_user_id == member_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The workspace founder cannot be removed.",
        )

    try:
        membership = await select_one_trusted(
            "workspace_members",
            "workspace_id,user_id,role",
            {"workspace_id": membership_workspace_id, "user_id": member_user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace member not found.",
        )

    target_role = normalize_workspace_role(
        membership.get("role"),
        member_user_id=member_user_id,
        owner_user_id=founder_user_id,
    )
    if access.role == "co_owner" and target_role != "member":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Co-owners can remove members only.",
        )

    try:
        await delete_many_trusted(
            "workspace_members",
            {"workspace_id": membership_workspace_id, "user_id": member_user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    await log_workspace_activity(
        workspace_id=membership_workspace_id,
        actor_user_id=user_id,
        event_type="workspace.member_removed",
        summary="A workspace member was removed.",
        metadata={"member_user_id": member_user_id, "role": target_role},
    )
    return None


@router.delete("/{workspace_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
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
            WORKSPACE_INVITE_COLUMNS,
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
        await update_one_trusted(
            "workspace_invites",
            {"id": invite_id},
            {"status": "revoked", "updated_at": utc_now_iso()},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    await log_workspace_activity(
        workspace_id=membership_workspace_id,
        actor_user_id=user_id,
        event_type="workspace.invite_revoked",
        summary="A workspace invite was revoked.",
        metadata={"invite_id": invite_id},
    )
    return None


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    await require_workspace_management_access(workspace_id, user_id)

    try:
        await delete_many_trusted("workspaces", {"id": workspace_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to delete workspace")
        raise _database_error() from exc

    return None
