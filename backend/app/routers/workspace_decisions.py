from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, status

from ..core.security import get_current_user
from ..schemas.workspace_decisions import (
    WorkspaceDecisionCreate,
    WorkspaceDecisionFromMessageCreate,
    WorkspaceDecisionRead,
)
from ..services.workspace_decision_service import (
    create_decision,
    create_decision_from_message,
    get_decision,
    list_decisions,
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
