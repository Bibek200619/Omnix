import logging
from typing import Any, List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..core.security import get_current_user
from .ai_rate_limits import enforce_expensive_ai_rate_limit
from ..schemas.continuity import (
    WorkspaceOperationalTimelineEvent
)
from ..schemas.workspace_initiatives import (
    WorkspaceInitiativeAssistanceRead,
    WorkspaceInitiativeAssistanceRequest,
    WorkspaceInitiativeChannelAttach,
    WorkspaceInitiativeCreate,
    WorkspaceInitiativeRead,
    WorkspaceInitiativeUpdate,
)
from ..services.chat_service import ModelServiceError, generate_ai_response
from ..services.prompt_trust import make_untrusted_data_record, untrusted_data_block
from ..services.workspace_initiative_service import (
    attach_channel,
    attach_task,
    create_initiative,
    detach_channel,
    get_initiative,
    initiative_evidence_for_assistance,
    list_initiatives,
    update_initiative,
)
from ..services.workspace_continuity_service import (
    get_continuity_timeline,
    list_unresolved_continuity
)
from ..services.workspace_service import utc_now_iso

router = APIRouter(prefix="/workspaces", tags=["continuity"])
logger = logging.getLogger(__name__)

ASSISTANCE_INSTRUCTIONS = {
    "state": "Summarize confirmed initiative state from the record and linked evidence. Separate completed state from open work.",
    "blockers": "List only explicitly recorded task blockers or blockers explicitly stated in attached discussion. Say clearly if none are recorded.",
    "momentum": "Describe recorded operational movement and identify silence only when the supplied derived state says dormant. Do not infer productivity.",
    "decisions": "Extract only explicit decisions in attached discussion or linked decision resources. If none are explicit, state that.",
}


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.post("/{workspace_id}/initiatives", response_model=WorkspaceInitiativeRead, status_code=status.HTTP_201_CREATED)
async def create_workspace_initiative(
    workspace_id: str,
    payload: WorkspaceInitiativeCreate,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await create_initiative(
        user_id=_user_id(user),
        workspace_id=workspace_id,
        payload=payload.model_dump(),
    )


@router.get("/{workspace_id}/initiatives", response_model=list[WorkspaceInitiativeRead])
async def get_workspace_initiatives(
    workspace_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await list_initiatives(user_id=_user_id(user), workspace_id=workspace_id)


@router.get("/{workspace_id}/initiatives/{initiative_id}", response_model=WorkspaceInitiativeRead)
async def get_workspace_initiative(
    workspace_id: str,
    initiative_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await get_initiative(workspace_id=workspace_id, initiative_id=initiative_id, user_id=_user_id(user))


@router.patch("/{workspace_id}/initiatives/{initiative_id}", response_model=WorkspaceInitiativeRead)
async def patch_workspace_initiative(
    workspace_id: str,
    initiative_id: str,
    payload: WorkspaceInitiativeUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await update_initiative(
        workspace_id=workspace_id,
        initiative_id=initiative_id,
        user_id=_user_id(user),
        payload=payload.model_dump(exclude_unset=True),
    )


@router.post("/{workspace_id}/initiatives/{initiative_id}/tasks/{task_id}", response_model=WorkspaceInitiativeRead)
async def attach_initiative_task(
    workspace_id: str,
    initiative_id: str,
    task_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await attach_task(
        workspace_id=workspace_id,
        initiative_id=initiative_id,
        task_id=task_id,
        user_id=_user_id(user),
    )


@router.post("/{workspace_id}/initiatives/{initiative_id}/channels", response_model=WorkspaceInitiativeRead)
async def attach_initiative_channel(
    workspace_id: str,
    initiative_id: str,
    payload: WorkspaceInitiativeChannelAttach,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await attach_channel(
        workspace_id=workspace_id,
        initiative_id=initiative_id,
        channel_id=payload.channel_id,
        user_id=_user_id(user),
    )


@router.delete("/{workspace_id}/initiatives/{initiative_id}/channels/{channel_id}", response_model=WorkspaceInitiativeRead)
async def detach_initiative_channel(
    workspace_id: str,
    initiative_id: str,
    channel_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await detach_channel(
        workspace_id=workspace_id,
        initiative_id=initiative_id,
        channel_id=channel_id,
        user_id=_user_id(user),
    )


@router.post("/{workspace_id}/initiatives/{initiative_id}/assist", response_model=WorkspaceInitiativeAssistanceRead)
async def assist_workspace_initiative(
    workspace_id: str,
    initiative_id: str,
    request: WorkspaceInitiativeAssistanceRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id(user)
    initiative, messages = await initiative_evidence_for_assistance(
        workspace_id=workspace_id,
        initiative_id=initiative_id,
        user_id=user_id,
    )
    tasks = initiative["linked_tasks"]
    resources = initiative["linked_resources"]
    evidence_records = [
        make_untrusted_data_record(
            kind="workspace_initiative_record",
            content=(
                f"Initiative: {initiative['title']} | status={initiative['status']} | "
                f"owner={initiative.get('owner_name') or initiative.get('owner_email') or 'unassigned'} | "
                f"target={initiative.get('target_date') or 'none'} | "
                f"derived_momentum={initiative['momentum']['health']} | "
                f"context={initiative.get('initiative_context') or initiative.get('description') or 'none'}"
            ),
            source_id=str(initiative.get("id") or initiative_id),
            source_type="workspace_initiative",
            workspace_id=workspace_id,
        ),
        make_untrusted_data_record(
            kind="initiative_linked_resources",
            content=str(resources),
            source_type="workspace_resource",
            workspace_id=workspace_id,
        ),
    ]
    evidence_records.extend(
        make_untrusted_data_record(
            kind="workspace_task_record",
            content=(
                f"Task: {task.get('title')} | status={task.get('status')} | "
                f"owner={task.get('owner_name') or task.get('owner_email') or 'unassigned'} | "
                f"due={task.get('due_date') or 'none'} | blockers={task.get('blockers') or []}"
            ),
            source_id=str(task.get("id") or ""),
            source_type="workspace_task",
            workspace_id=workspace_id,
        )
        for task in tasks
    )
    evidence_records.extend(
        make_untrusted_data_record(
            kind="workspace_conversation_message",
            content=(
                f"{message.get('author_name') or message.get('author_email') or 'Teammate'}: "
                f"{message.get('content', '')}"
            ),
            source_id=str(message.get("id") or ""),
            source_type="workspace_channel_message",
            workspace_id=workspace_id,
        )
        for message in messages
    )
    system_prompt = (
        "You assist an operational initiative outside its records. "
        "Use only the supplied initiative, task, resource, and conversation evidence. "
        "Never invent progress, completion, ownership, deadlines, blockers, decisions, or health."
    )
    prompt = (
        f"{ASSISTANCE_INSTRUCTIONS[request.mode]}\n\n"
        f"{untrusted_data_block('INITIATIVE EVIDENCE (UNTRUSTED):', evidence_records)}"
    )
    await enforce_expensive_ai_rate_limit(
        user_id=user_id,
        workspace_id=workspace_id,
        endpoint="workspace.initiatives.assist",
    )
    try:
        generation = await generate_ai_response(prompt, system_prompt=system_prompt, temperature=0.1, max_tokens=480)
    except ModelServiceError as exc:
        logger.exception("Failed to generate initiative assistance")
        raise HTTPException(status_code=exc.status_code, detail="Initiative assistance is unavailable.") from exc
    return {
        "mode": request.mode,
        "content": generation.content,
        "source_task_count": len(tasks),
        "source_channel_count": len(initiative["linked_channels"]),
        "source_message_count": len(messages),
        "generated_at": utc_now_iso(),
    }

@router.get("/{workspace_id}/timeline", response_model=List[WorkspaceOperationalTimelineEvent])
async def get_workspace_timeline(
    workspace_id: UUID,
    initiative_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        return await get_continuity_timeline(
            user_id=UUID(_user_id(user)),
            workspace_id=workspace_id,
            initiative_id=initiative_id,
            limit=limit
        )
    except ValueError as exc:
        logger.warning("Workspace timeline access denied: %s", exc)
        raise HTTPException(status_code=403, detail="Workspace continuity is unavailable.") from exc
    except Exception as exc:
        logger.exception("Failed to load workspace timeline")
        raise HTTPException(status_code=500, detail="Workspace continuity is unavailable.") from exc

@router.get("/{workspace_id}/continuity/unresolved", response_model=List[dict])
async def get_unresolved_continuity(
    workspace_id: UUID,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        return await list_unresolved_continuity(
            user_id=UUID(_user_id(user)),
            workspace_id=workspace_id
        )
    except ValueError as exc:
        logger.warning("Workspace continuity access denied: %s", exc)
        raise HTTPException(status_code=403, detail="Workspace continuity is unavailable.") from exc
    except Exception as exc:
        logger.exception("Failed to load unresolved continuity")
        raise HTTPException(status_code=500, detail="Workspace continuity is unavailable.") from exc
