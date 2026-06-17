from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, status

from ..core.security import get_current_user
from ..schemas.workspace_decisions import (
    DecisionCandidateListRead,
    DecisionCandidateMetricCreate,
    WorkspaceDecisionCreate,
    WorkspaceDecisionFromMessageCreate,
    WorkspaceDecisionLinkInitiative,
    WorkspaceDecisionLinkTask,
    WorkspaceDecisionPageRead,
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
from ..services.decision_candidate_service import (
    conversation_decision_candidates,
    document_decision_candidates,
    log_candidate_metrics,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/decisions", tags=["workspace-decisions"])


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.get("", response_model=WorkspaceDecisionPageRead)
async def get_workspace_decisions(
    workspace_id: str,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await list_decisions(workspace_id=workspace_id, user_id=_user_id(current_user), cursor=cursor, limit=limit)


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


@router.post("/candidates/conversation/{channel_id}", response_model=DecisionCandidateListRead)
async def post_conversation_decision_candidates(
    workspace_id: str,
    channel_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await conversation_decision_candidates(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=_user_id(current_user),
    )


@router.post("/candidates/document/{file_id}", response_model=DecisionCandidateListRead)
async def post_document_decision_candidates(
    workspace_id: str,
    file_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await document_decision_candidates(
        workspace_id=workspace_id,
        file_id=file_id,
        user_id=_user_id(current_user),
    )


@router.post("/candidates/metrics", status_code=status.HTTP_204_NO_CONTENT)
async def post_decision_candidate_metric(
    workspace_id: str,
    payload: DecisionCandidateMetricCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    await log_candidate_metrics(
        workspace_id=workspace_id,
        user_id=_user_id(current_user),
        source_type=payload.source_type,
        source_id=payload.source_id,
        action=payload.action,
        candidate_id=payload.candidate_id,
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
