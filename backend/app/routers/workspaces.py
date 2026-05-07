from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..core.security import get_current_user
from ..services.supabase_service import SupabaseServiceError, insert_one, select_all, select_one, update_one
from ..schemas.chat import WorkspaceCreate, WorkspaceRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

WORKSPACE_COLUMNS = "id,user_id,name,description,created_at,updated_at"


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


async def _validate_workspace_ownership(workspace_id: str, user_id: str) -> None:
    try:
        ws = await select_one("workspaces", "id,user_id", {"id": workspace_id, "user_id": user_id})
    except SupabaseServiceError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error") from exc

    if ws is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
async def create_workspace(workspace_payload: WorkspaceCreate, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    payload = {"user_id": user_id, **workspace_payload.model_dump(exclude_none=True)}

    try:
        return await insert_one("workspaces", payload)
    except SupabaseServiceError as exc:
        logger.exception("Failed to create workspace")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error") from exc


@router.get("", response_model=list[WorkspaceRead])
async def list_workspaces(current_user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    try:
        return await select_all("workspaces", WORKSPACE_COLUMNS, filters={"user_id": user_id}, order_by="created_at", desc=False)
    except SupabaseServiceError as exc:
        logger.exception("Failed to list workspaces")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error") from exc


@router.get("/{workspace_id}", response_model=WorkspaceRead)
async def get_workspace(workspace_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    try:
        ws = await select_one("workspaces", WORKSPACE_COLUMNS, filters={"id": workspace_id, "user_id": user_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to read workspace")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error") from exc

    if ws is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return ws


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(workspace_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> None:
    user_id = _user_id_from_claims(current_user)

    # ensure workspace exists and belongs to user
    await _validate_workspace_ownership(workspace_id, user_id)

    try:
        # soft-delete by setting a flag could be implemented; for now delete
        get = await select_one("workspaces", "id", {"id": workspace_id, "user_id": user_id})
        if not get:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
        # perform low-level delete using service client
        from ..db.supabase import get_supabase
        supabase = get_supabase()
        supabase.table("workspaces").delete().eq("id", workspace_id).eq("user_id", user_id).execute()
    except SupabaseServiceError as exc:
        logger.exception("Failed to delete workspace")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error") from exc

    return None
