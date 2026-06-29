from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from ..core.security import get_current_user
from ..schemas.workspace_search import WorkspaceSearchResponse
from ..services.workspace_search_service import search_workspace

router = APIRouter(prefix="/workspaces/{workspace_id}/search", tags=["workspace-search"])


def _user_id(current_user: dict[str, Any]) -> str:
    return str(current_user.get("sub") or current_user.get("id"))


@router.get("", response_model=WorkspaceSearchResponse)
async def get_workspace_search(
    workspace_id: str,
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=8, ge=1, le=25),
    cursor: int = Query(default=0, ge=0),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await search_workspace(
        workspace_id=workspace_id,
        user_id=_user_id(current_user),
        query=q,
        limit=limit,
        cursor=cursor,
    )
