from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..core.security import get_current_user
from ..schemas.workspace_mentions import WorkspaceMentionRead
from ..services.workspace_mention_service import list_mentions_for_user

router = APIRouter(prefix="/workspaces/{workspace_id}/mentions", tags=["workspace-mentions"])


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.get("", response_model=list[WorkspaceMentionRead])
async def get_workspace_mentions(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await list_mentions_for_user(workspace_id=workspace_id, user_id=_user_id(current_user))
