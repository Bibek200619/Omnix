from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from .ai_rate_limits import enforce_expensive_ai_rate_limit
from ..schemas.workspace_tasks import (
    WorkspaceTaskAssistanceRead,
    WorkspaceTaskAssistanceRequest,
    WorkspaceTaskCreate,
    WorkspaceTaskFromAssistanceCreate,
    WorkspaceTaskFromMessageCreate,
    WorkspaceTaskMomentumRead,
    WorkspaceTaskRead,
    WorkspaceTaskUpdate,
)
from ..services.chat_service import ModelServiceError, generate_ai_response
from ..services.prompt_trust import make_untrusted_data_record, untrusted_data_block
from ..services.workspace_service import require_workspace_access, utc_now_iso
from ..services.workspace_task_service import (
    create_task,
    create_task_from_assistance,
    create_task_from_message,
    list_tasks,
    task_momentum,
    task_transcript_for_assistance,
    update_task,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/tasks", tags=["workspace-tasks"])
logger = logging.getLogger(__name__)

ASSISTANCE_INSTRUCTIONS = {
    "blockers": "List only explicitly recorded blockers and which task carries them. If there are none, state that clearly.",
    "stalled": "Identify tasks with recorded due-date or blocker evidence requiring attention. Never label an undated task stalled.",
    "next_actions": "Suggest cautious next actions from the recorded title, description, status, and blockers. Do not state that work occurred.",
    "workload": "Summarize recorded ownership distribution. Do not call a member overloaded unless the visible assignment count supports that observation.",
}


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.get("", response_model=list[WorkspaceTaskRead])
async def get_tasks(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    await require_workspace_access(workspace_id, _user_id(current_user))
    return await list_tasks(workspace_id=workspace_id, user_id=_user_id(current_user))


@router.post("", response_model=WorkspaceTaskRead, status_code=status.HTTP_201_CREATED)
async def post_task(
    workspace_id: str,
    payload: WorkspaceTaskCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, _user_id(current_user))
    return await create_task(
        workspace_id=workspace_id,
        user_id=_user_id(current_user),
        payload=payload.model_dump(),
    )


@router.get("/momentum", response_model=WorkspaceTaskMomentumRead)
async def get_momentum(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, _user_id(current_user))
    return await task_momentum(workspace_id=workspace_id, user_id=_user_id(current_user))


@router.post("/from-message/{channel_id}/{message_id}", response_model=WorkspaceTaskRead, status_code=status.HTTP_201_CREATED)
async def post_task_from_message(
    workspace_id: str,
    channel_id: str,
    message_id: str,
    payload: WorkspaceTaskFromMessageCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, _user_id(current_user))
    return await create_task_from_message(
        workspace_id=workspace_id,
        channel_id=channel_id,
        message_id=message_id,
        user_id=_user_id(current_user),
        payload=payload.model_dump(),
    )


@router.post("/from-assistance/{channel_id}", response_model=WorkspaceTaskRead, status_code=status.HTTP_201_CREATED)
async def post_task_from_assistance(
    workspace_id: str,
    channel_id: str,
    payload: WorkspaceTaskFromAssistanceCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, _user_id(current_user))
    return await create_task_from_assistance(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=_user_id(current_user),
        payload=payload.model_dump(),
    )


@router.post("/assist", response_model=WorkspaceTaskAssistanceRead)
async def assist_execution(
    workspace_id: str,
    request: WorkspaceTaskAssistanceRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id(current_user)
    await require_workspace_access(workspace_id, user_id)
    tasks = await task_transcript_for_assistance(workspace_id=workspace_id, user_id=user_id)
    if not tasks:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="There are no recorded tasks to assist yet.")
    await enforce_expensive_ai_rate_limit(
        user_id=user_id,
        workspace_id=workspace_id,
        endpoint="workspace.tasks.assist",
    )
    task_records = [
        make_untrusted_data_record(
            kind="workspace_task_record",
            content=(
                f"Task: {task.get('title')} | status={task.get('status')} | "
                f"owner={task.get('owner_name') or task.get('owner_email') or 'unassigned'} | "
                f"due={task.get('due_date') or 'none'} | blockers={task.get('blockers') or []} | "
                f"description={task.get('description') or ''}"
            ),
            source_id=str(task.get("id") or ""),
            source_type="workspace_task",
            workspace_id=workspace_id,
        )
        for task in tasks
    ]
    system_prompt = (
        "You assist an operational workspace outside the task ledger. "
        "Use only the provided task records. Be restrained and factual. "
        "Never invent progress, ownership, deadlines, completion, blockers, or execution state."
    )
    prompt = (
        f"{ASSISTANCE_INSTRUCTIONS[request.mode]}\n\n"
        f"{untrusted_data_block('TASK RECORDS (UNTRUSTED):', task_records)}"
    )
    try:
        generation = await generate_ai_response(
            prompt,
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=420,
        )
    except ModelServiceError as exc:
        logger.exception("Failed to generate task assistance")
        raise HTTPException(status_code=exc.status_code, detail="Task assistance is unavailable.") from exc
    return {
        "mode": request.mode,
        "content": generation.content,
        "source_task_count": len(tasks),
        "generated_at": utc_now_iso(),
    }


@router.patch("/{task_id}", response_model=WorkspaceTaskRead)
async def patch_task(
    workspace_id: str,
    task_id: str,
    payload: WorkspaceTaskUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, _user_id(current_user))
    return await update_task(
        workspace_id=workspace_id,
        task_id=task_id,
        user_id=_user_id(current_user),
        payload=payload.model_dump(exclude_unset=True),
    )
