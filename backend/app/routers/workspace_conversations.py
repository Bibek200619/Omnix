from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..core.security import get_current_user
from ..schemas.workspace_conversations import (
    WorkspaceChannelCreate,
    WorkspaceChannelMessageCreate,
    WorkspaceChannelMessageRead,
    WorkspaceChannelRead,
    WorkspaceConversationAssistanceRead,
    WorkspaceConversationAssistanceRequest,
)
from ..services.chat_service import ModelServiceError, generate_ai_response
from ..services.workspace_collaboration_service import log_workspace_activity
from ..services.workspace_conversation_service import (
    channel_transcript_for_assistance,
    create_channel,
    create_message,
    list_channels,
    list_messages,
)
from ..services.workspace_service import require_workspace_access, utc_now_iso

router = APIRouter(prefix="/workspaces/{workspace_id}/channels", tags=["workspace-conversations"])
logger = logging.getLogger(__name__)

ASSISTANCE_INSTRUCTIONS = {
    "summary": "Summarize current operational state in concise prose. Separate confirmed outcomes from open discussion.",
    "decisions": "Extract only explicit decisions. If none are explicit, state that no confirmed decision is present.",
    "actions": "List concrete action candidates with owner only when an owner is explicitly named. Do not invent commitments.",
    "blockers": "Identify stated blockers and dependencies. Do not infer risk as a blocker unless the discussion says so.",
}


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.get("", response_model=list[WorkspaceChannelRead])
async def get_workspace_channels(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await list_channels(workspace_id=workspace_id, user_id=_user_id(current_user))


@router.post("", response_model=WorkspaceChannelRead, status_code=status.HTTP_201_CREATED)
async def create_workspace_channel(
    workspace_id: str,
    channel_payload: WorkspaceChannelCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id(current_user)
    access = await require_workspace_access(workspace_id, user_id)
    created = await create_channel(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=channel_payload.model_dump(),
        role=str(access.role),
    )
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="conversation.channel_created",
        summary=f"{created.get('name') or 'A channel'} operational channel was opened.",
        metadata={"channel_id": created.get("id")},
    )
    return created


@router.get("/{channel_id}/messages", response_model=list[WorkspaceChannelMessageRead])
async def get_channel_messages(
    workspace_id: str,
    channel_id: str,
    limit: int = Query(default=60, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    thread_root_id: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await list_messages(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=_user_id(current_user),
        limit=limit,
        offset=offset,
        thread_root_id=thread_root_id,
    )


@router.post("/{channel_id}/messages", response_model=WorkspaceChannelMessageRead, status_code=status.HTTP_201_CREATED)
async def post_channel_message(
    workspace_id: str,
    channel_id: str,
    message_payload: WorkspaceChannelMessageCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await create_message(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=_user_id(current_user),
        payload=message_payload.model_dump(),
    )


@router.post("/{channel_id}/assist", response_model=WorkspaceConversationAssistanceRead)
async def assist_channel_discussion(
    workspace_id: str,
    channel_id: str,
    request: WorkspaceConversationAssistanceRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    messages = await channel_transcript_for_assistance(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=_user_id(current_user),
        thread_root_id=request.thread_root_id,
    )
    if not messages:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="There is no discussion to assist yet.")

    transcript = "\n".join(
        f"{message.get('author_name') or message.get('author_email') or 'Teammate'}: {message.get('content', '')}"
        for message in messages[-60:]
    )
    system_prompt = (
        "You assist an operational workspace discussion outside the transcript. "
        "Use only the provided discussion. Be restrained, factual, and brief. "
        "Never invent decisions, owners, deadlines, blockers, or completed work."
    )
    prompt = f"{ASSISTANCE_INSTRUCTIONS[request.mode]}\n\nDISCUSSION:\n{transcript}"
    try:
        generation = await generate_ai_response(
            prompt,
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=420,
        )
    except ModelServiceError as exc:
        logger.exception("Failed to generate conversation assistance")
        raise HTTPException(status_code=exc.status_code, detail="Conversation assistance is unavailable.") from exc

    return {
        "mode": request.mode,
        "content": generation.content,
        "source_message_count": len(messages),
        "generated_at": utc_now_iso(),
    }
