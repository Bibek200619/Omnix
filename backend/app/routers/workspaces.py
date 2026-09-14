from __future__ import annotations

from collections.abc import Mapping
import logging
import reprlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from ..schemas.chat import (
    WorkspaceCreate,
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
    WorkspaceTreeRead,
    WorkspaceUpdate,
)
from ..services.supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)
from ..services.workspace_service import (
    WORKSPACE_COLUMNS,
    assign_member_to_subspace,
    create_subspace_for_user,
    create_workspace_for_user,
    get_global_space_for_super_workspace,
    is_super_workspace,
    is_subspace,
    list_potential_subspace_members,
    list_subspaces_for_super_workspace,
    list_user_workspaces,
    list_workspace_members,
    normalize_operational_label,
    normalize_workspace_record,
    normalize_workspace_focus,
    normalize_workspace_role,
    require_workspace_access,
    require_workspace_management_access,
    utc_now_iso,
    validate_workspace_relationship,
)
from ..services.workspace_intelligence_service import build_workspace_intelligence_profile
from ..services.workspace_collaboration_service import (
    heartbeat_workspace_presence,
    invalidate_workspace_presence_cache,
    leave_workspace_presence,
    list_workspace_activity,
    list_workspace_live_statuses,
    list_workspace_presence,
    log_workspace_activity,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


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


def _mutation_workspace(access: Any) -> dict[str, Any]:
    workspace = getattr(access, "workspace", {})
    return dict(workspace) if isinstance(workspace, Mapping) else {}


def _mutation_workspace_id(access: Any) -> str:
    workspace_id = getattr(access, "workspace_id", None)
    if workspace_id:
        return str(workspace_id)
    workspace = _mutation_workspace(access)
    return str(workspace.get("id") or "")


def _is_inherited_global_workspace(workspace: Mapping[str, Any]) -> bool:
    normalized = normalize_workspace_record(dict(workspace))
    return bool(normalized.get("is_global")) or normalized.get("workspace_type") == "global_workspace"


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


@router.get("", response_model=list[WorkspaceRead])
async def list_workspaces(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    try:
        return await list_user_workspaces(user_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to list user workspaces.")
        raise _database_error() from exc


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




@router.get("/{workspace_id}/telemetry")
async def get_workspace_telemetry(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    from datetime import datetime, timedelta, timezone
    user_id = _user_id_from_claims(current_user)
    access = await require_workspace_access(workspace_id, user_id)
    
    today = datetime.now(timezone.utc).date()
    dates = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    start_date_str = (today - timedelta(days=6)).isoformat() + "T00:00:00Z"
    
    try:
        conversations = await select_all_trusted(
            "conversations", "id,created_at",
            {"workspace_id": workspace_id, "created_at": {"gte": start_date_str}}
        )
        files = await select_all_trusted(
            "files", "id,created_at",
            {"workspace_id": workspace_id, "created_at": {"gte": start_date_str}}
        )
        
        convo_ids = [c["id"] for c in conversations if "id" in c]
        messages = []
        if convo_ids:
            messages = await select_all_trusted(
                "messages", "id,content,created_at",
                {"conversation_id": convo_ids}
            )
            
    except Exception as exc:
        logger.warning("Failed to load telemetry stats", exc_info=True)
        conversations, files, messages = [], [], []

    convo_counts = {d: 0 for d in dates}
    file_counts = {d: 0 for d in dates}
    token_counts = {d: 0 for d in dates}
    
    for c in conversations:
        dt = c.get("created_at", "")[:10]
        if dt in convo_counts: convo_counts[dt] += 1
            
    for f in files:
        dt = f.get("created_at", "")[:10]
        if dt in file_counts: file_counts[dt] += 1
            
    for m in messages:
        dt = m.get("created_at", "")[:10]
        if dt in token_counts:
            token_counts[dt] += len(str(m.get("content") or "")) // 4

    return {
        "dates": [d[5:] for d in dates],
        "conversations": [convo_counts[d] for d in dates],
        "sources": [file_counts[d] for d in dates],
        "tokens": [token_counts[d] for d in dates]
    }

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
    raw_payload = intelligence_payload.model_dump(exclude_unset=True)
    focus = normalize_workspace_focus(
        raw_payload.get("workspace_focus")
        or raw_payload.get("ai_specialization")
        or normalized_workspace.get("workspace_focus")
        or normalized_workspace.get("ai_specialization")
    )
    payload: dict[str, Any] = {
        "workspace_focus": focus,
        # Compatibility mirror until all clients stop reading ai_specialization.
        "ai_specialization": focus,
    }
    payload["expertise_area"] = (
        str(raw_payload.get("expertise_area") or "").strip()
        if "expertise_area" in raw_payload
        else str(normalized_workspace.get("expertise_area") or "").strip()
    ) or None
    payload["ai_instructions"] = (
        str(raw_payload.get("ai_instructions") or "").strip()
        if "ai_instructions" in raw_payload
        else str(normalized_workspace.get("ai_instructions") or "").strip()
    ) or None
    preferences_payload = raw_payload.get("intelligence_preferences")
    if not isinstance(preferences_payload, Mapping):
        preferences_payload = normalized_workspace.get("intelligence_preferences") or {}
    payload["expertise_area"] = str(payload.get("expertise_area") or "").strip() or None
    payload["ai_instructions"] = str(payload.get("ai_instructions") or "").strip() or None
    payload["intelligence_preferences"] = {
        **dict(preferences_payload),
        "retrieval_scope": "global" if normalized_workspace.get("is_global") else dict(preferences_payload).get("retrieval_scope", "workspace"),
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
            "workspace_focus": payload.get("workspace_focus"),
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
    if "workspace_focus" in payload or "ai_specialization" in payload:
        focus = normalize_workspace_focus(
            payload.get("workspace_focus") or payload.get("ai_specialization")
        )
        payload["workspace_focus"] = focus
        # Compatibility mirror until all clients stop reading ai_specialization.
        payload["ai_specialization"] = focus

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

    mutation_workspace = _mutation_workspace(access)
    if _is_inherited_global_workspace(mutation_workspace):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Global space roles inherit from the parent organization. Manage roles from the parent workspace.",
        )

    mutation_workspace_id = _mutation_workspace_id(access)
    founder_user_id = str(mutation_workspace.get("user_id") or "")
    if founder_user_id == member_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The workspace founder role cannot be changed.",
        )

    try:
        membership = await select_one_trusted(
            "workspace_members",
            "workspace_id,user_id,role,operational_label",
            {"workspace_id": mutation_workspace_id, "user_id": member_user_id},
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

    # In the scoped model, subleaders, team leads and co-owners cannot escalate their own privileges or demote founders
    if access.role in {"co_owner", "sub_leader", "team_lead"} and (current_member_role not in {"member", "sub_member"} or next_role not in {"member", "sub_member"}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only manage standard members.",
        )

    try:
        updates: dict[str, Any] = {"role": next_role, "updated_at": utc_now_iso()}
        if "operational_label" in role_payload.model_fields_set:
            updates["operational_label"] = normalize_operational_label(role_payload.operational_label)
        updated_membership = await update_one_trusted(
            "workspace_members",
            {"workspace_id": mutation_workspace_id, "user_id": member_user_id},
            updates,
        )
        if updated_membership is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace member not found.",
            )
        
        # Emit authority revocation event for the role change
        from app.services.realtime_service import emit_authority_revocation
        emitted = await emit_authority_revocation(
            user_id=member_user_id,
            workspace_id=mutation_workspace_id,
            revocation_type="role_changed",
            payload={"new_role": next_role}
        )
        if not emitted:
            logger.error(
                "Authority revocation emission failed after role update | workspace_id=%s | user_id=%s",
                mutation_workspace_id,
                member_user_id,
            )
        
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    await log_workspace_activity(
        workspace_id=mutation_workspace_id,
        actor_user_id=user_id,
        event_type="workspace.member_role_updated",
        summary="A workspace member role was updated.",
        metadata={
            "member_user_id": member_user_id,
            "role": next_role,
            "identity_updated": "operational_label" in role_payload.model_fields_set,
        },
    )
    members = await list_workspace_members(access.workspace)
    for member in members:
        if member.get("user_id") == member_user_id:
            return member

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Workspace member not found.",
    )


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
    is_super = is_super_workspace(access.workspace)

    if not OrganizationalAccessAuthority.can_remove_members(access.role, workspace_type):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to remove members from this workspace.",
        )

    mutation_workspace = _mutation_workspace(access)
    if _is_inherited_global_workspace(mutation_workspace):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Global space membership is inherited from the parent organization. Remove members from the parent workspace or a scoped private subspace.",
        )

    mutation_workspace_id = _mutation_workspace_id(access)
    founder_user_id = str(mutation_workspace.get("user_id") or "")
    
    if founder_user_id == member_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The workspace founder cannot be removed.",
        )

    try:
        membership = await select_one_trusted(
            "workspace_members",
            "workspace_id,user_id,role",
            {"workspace_id": mutation_workspace_id, "user_id": member_user_id},
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

    # Phase 5: Permission enforcement logic
    if is_super:
        # Removing from super workspace means organization-wide revocation
        if access.role != "founder":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the organization founder can remove members from the entire organization.",
            )
    elif access.role == "co_owner" and target_role != "member":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Co-owners can remove members only.",
        )
    elif access.role == "team_lead" and target_role != "member":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Team leads can remove members only.",
        )

    # Prepare for cascading removal if it is a super workspace
    workspace_ids_to_clean = [mutation_workspace_id]
    if is_super:
        try:
            subspaces = await select_all_trusted(
                "workspaces",
                "id",
                {"parent_workspace_id": mutation_workspace_id}
            )
            workspace_ids_to_clean.extend([str(s["id"]) for s in subspaces])
        except SupabaseServiceError as exc:
            logger.exception(
                "Failed to fetch subspaces for cascading removal | super_workspace_id=%s",
                mutation_workspace_id,
            )
            raise _database_error() from exc

    try:
        # Batch delete memberships
        await delete_many_trusted(
            "workspace_members",
            {"workspace_id": workspace_ids_to_clean, "user_id": member_user_id},
        )

        remaining_membership = await select_one_trusted(
            "workspace_members",
            "workspace_id,user_id",
            {"workspace_id": workspace_ids_to_clean, "user_id": member_user_id},
        )
        if remaining_membership is not None:
            logger.error(
                "Workspace member removal verification failed | workspace_ids=%s | user_id=%s",
                workspace_ids_to_clean,
                member_user_id,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Workspace member removal did not complete. Please retry.",
            )
        
        # Emit authority revocation events for all affected workspaces
        from app.services.realtime_service import emit_authority_revocation
        for wid in workspace_ids_to_clean:
            emitted = await emit_authority_revocation(
                user_id=member_user_id,
                workspace_id=wid,
                revocation_type="membership_removed"
            )
            if not emitted:
                logger.error(
                    "Authority revocation emission failed after member removal | workspace_id=%s | user_id=%s",
                    wid,
                    member_user_id,
                )
            
            # Cleanup presence for all affected workspaces
            await leave_workspace_presence(workspace_id=wid, user_id=member_user_id)
            await invalidate_workspace_presence_cache(workspace_id=wid)
            
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    await log_workspace_activity(
        workspace_id=mutation_workspace_id,
        actor_user_id=user_id,
        event_type="workspace.member_removed",
        summary="An organization member was removed." if is_super else "A workspace member was removed.",
        metadata={
            "member_user_id": member_user_id, 
            "role": target_role,
            "is_organization_removal": is_super,
            "cascaded_workspace_count": len(workspace_ids_to_clean)
        },
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
        # Fetch members before deletion for notification
        members = await select_all_trusted(
            "workspace_members", 
            "user_id", 
            {"workspace_id": workspace_id}
        )
        
        await delete_many_trusted("workspaces", {"id": workspace_id})
        
        # Notify all members
        from app.services.realtime_service import emit_authority_revocation
        for m in members:
            await emit_authority_revocation(
                user_id=str(m["user_id"]),
                workspace_id=workspace_id,
                revocation_type="workspace_deleted"
            )
            
    except SupabaseServiceError as exc:
        logger.exception("Failed to delete workspace")
        raise _database_error() from exc

    return None
