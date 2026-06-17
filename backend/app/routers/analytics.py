from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..core.security import get_current_user
from ..services.workspace_analytics_service import get_workspace_analytics

router = APIRouter(prefix="/workspaces/{workspace_id}/analytics", tags=["workspace-analytics"])


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.get("")
async def get_workspace_analytics_route(
    workspace_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await get_workspace_analytics(workspace_id=workspace_id, user_id=_user_id(current_user))
