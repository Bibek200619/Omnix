from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, status

from ..core.security import get_current_user
from ..schemas.workspace_decisions import (
    WorkspaceDecisionCreate,
    WorkspaceDecisionFromMessageCreate,
    WorkspaceDecisionLinkInitiative,
    WorkspaceDecisionLinkTask,
    WorkspaceDecisionRead,
    WorkspaceDecisionStatusUpdate,
)
from ..services.workspace_decision_service import (
    create_decision,
    create_decision_from_message,
    get_decision,
    link_initiative_to_decision,
    link_task_to_decision,
    list_decisions,
    unlink_task_from_decision,
    update_decision_status,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/decisions", tags=["workspace-decisions"])


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.get("", response_model=list[WorkspaceDecisionRead])
async def get_workspace_decisions(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await list_decisions(workspace_id=workspace_id, user_id=_user_id(current_user))


@router.post("", response_model=WorkspaceDecisionRead, status_code=status.HTTP_201_CREATED)
async def post_workspace_decision(
    workspace_id: str,
    payload: WorkspaceDecisionCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await create_decision(
        workspace_id=workspace_id,
        user_id=_user_id(current_user),
        payload=payload.model_dump(),
    )


@router.post(
    "/from-message/{channel_id}/{message_id}",
    response_model=WorkspaceDecisionRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_workspace_decision_from_message(
    workspace_id: str,
    channel_id: str,
    message_id: str,
    payload: WorkspaceDecisionFromMessageCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await create_decision_from_message(
        workspace_id=workspace_id,
        channel_id=channel_id,
        message_id=message_id,
        user_id=_user_id(current_user),
        payload=payload.model_dump(),
    )


@router.get("/{decision_id}", response_model=WorkspaceDecisionRead)
async def get_workspace_decision(
    workspace_id: str,
    decision_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await get_decision(
        workspace_id=workspace_id,
        decision_id=decision_id,
        user_id=_user_id(current_user),
    )


@router.patch("/{decision_id}/status", response_model=WorkspaceDecisionRead)
async def patch_workspace_decision_status(
    workspace_id: str,
    decision_id: str,
    payload: WorkspaceDecisionStatusUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await update_decision_status(
        workspace_id=workspace_id,
        decision_id=decision_id,
        user_id=_user_id(current_user),
        status=payload.status,
    )


@router.post("/{decision_id}/tasks", response_model=WorkspaceDecisionRead)
async def post_workspace_decision_link_task(
    workspace_id: str,
    decision_id: str,
    payload: WorkspaceDecisionLinkTask,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await link_task_to_decision(
        workspace_id=workspace_id,
        decision_id=decision_id,
        task_id=payload.task_id,
        user_id=_user_id(current_user),
    )


@router.delete("/{decision_id}/tasks/{task_id}", response_model=WorkspaceDecisionRead)
async def delete_workspace_decision_link_task(
    workspace_id: str,
    decision_id: str,
    task_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await unlink_task_from_decision(
        workspace_id=workspace_id,
        decision_id=decision_id,
        task_id=task_id,
        user_id=_user_id(current_user),
    )


@router.patch("/{decision_id}/initiative", response_model=WorkspaceDecisionRead)
async def patch_workspace_decision_initiative(
    workspace_id: str,
    decision_id: str,
    payload: WorkspaceDecisionLinkInitiative,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await link_initiative_to_decision(
        workspace_id=workspace_id,
        decision_id=decision_id,
        initiative_id=payload.initiative_id,
        user_id=_user_id(current_user),
    )
