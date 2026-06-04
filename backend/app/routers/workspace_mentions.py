from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..core.security import get_current_user
from ..schemas.workspace_mentions import (
    WorkspaceMentionMarkAllReadResponse,
    WorkspaceMentionMarkReadResponse,
    WorkspaceMentionRead,
    WorkspaceMentionUnreadCount,
)
from ..services.workspace_mention_service import (
    count_unread_mentions_for_user,
    list_mentions_for_user,
    mark_all_mentions_read,
    mark_mention_read,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/mentions", tags=["workspace-mentions"])


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.get("", response_model=list[WorkspaceMentionRead])
async def get_workspace_mentions(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await list_mentions_for_user(workspace_id=workspace_id, user_id=_user_id(current_user))


@router.get("/unread-count", response_model=WorkspaceMentionUnreadCount)
async def get_workspace_mentions_unread_count(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, int]:
    return await count_unread_mentions_for_user(workspace_id=workspace_id, user_id=_user_id(current_user))


@router.patch("/read-all", response_model=WorkspaceMentionMarkAllReadResponse)
async def mark_workspace_mentions_read(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await mark_all_mentions_read(workspace_id=workspace_id, user_id=_user_id(current_user))


@router.patch("/{mention_id}/read", response_model=WorkspaceMentionMarkReadResponse)
async def mark_workspace_mention_read(
    workspace_id: str,
    mention_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await mark_mention_read(workspace_id=workspace_id, user_id=_user_id(current_user), mention_id=mention_id)
