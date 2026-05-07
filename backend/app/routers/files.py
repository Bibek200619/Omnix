from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse

from ..core.security import get_current_user
from ..db.supabase import get_supabase
from ..schemas.chat import FileCreate, FileRead
from ..services.supabase_service import SupabaseServiceError, insert_one, select_all, select_one

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/files", tags=["files"])
FILE_COLUMNS = "id,user_id,workspace_id,conversation_id,file_name,file_type,size_bytes,storage_path,metadata,created_at"
CONVERSATION_OWNERSHIP_COLUMNS = "id,user_id"
DEFAULT_FILE_LIMIT = 50
MAX_FILE_LIMIT = 100


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


async def _validate_conversation_ownership(conversation_id: str, user_id: str) -> None:
    try:
        conversation = await select_one(
            "conversations",
            CONVERSATION_OWNERSHIP_COLUMNS,
            {"id": conversation_id, "user_id": user_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found.",
        )


@router.post("", response_model=FileRead, status_code=status.HTTP_201_CREATED)
async def _validate_workspace_ownership(workspace_id: str, user_id: str) -> None:
    try:
        workspace = await select_one("workspaces", "id,user_id", {"id": workspace_id, "user_id": user_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")


async def create_file_metadata(
    file_payload: FileCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)

    if file_payload.conversation_id:
        await _validate_conversation_ownership(file_payload.conversation_id, user_id)

    if getattr(file_payload, "workspace_id", None):
        await _validate_workspace_ownership(file_payload.workspace_id, user_id)

    payload = {"user_id": user_id, **file_payload.model_dump(exclude_none=True)}

    try:
        return await insert_one("files", payload)
    except SupabaseServiceError as exc:
        raise _database_error() from exc


@router.get("", response_model=list[FileRead])
async def get_files(
    limit: int = Query(default=DEFAULT_FILE_LIMIT, ge=1, le=MAX_FILE_LIMIT),
    offset: int = Query(default=0, ge=0),
    conversation_id: str | None = Query(default=None),
    workspace_id: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)

    filters = {"user_id": user_id}
    if conversation_id is not None:
        filters["conversation_id"] = conversation_id
    if workspace_id is not None:
        filters["workspace_id"] = workspace_id

    try:
        return await select_all(
            "files",
            FILE_COLUMNS,
            filters=filters,
            order_by="created_at",
            desc=True,
            limit=limit,
            offset=offset,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc


@router.get("/{file_id}/download")
async def download_file(
    file_id: str, current_user: dict[str, Any] = Depends(get_current_user)
) -> FileResponse:
    user_id = _user_id_from_claims(current_user)

    try:
        file_row = await select_one("files", FILE_COLUMNS, {"id": file_id, "user_id": user_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if file_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    storage_path = file_row.get("storage_path")
    if not storage_path or not os.path.exists(storage_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File content not found on server")

    filename = file_row.get("file_name") or "download"
    file_type = file_row.get("file_type") or "application/octet-stream"
    return FileResponse(path=storage_path, filename=filename, media_type=file_type)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: str, current_user: dict[str, Any] = Depends(get_current_user)
) -> None:
    """Delete a file owned by the authenticated user. Attempts to remove DB record and local storage path if present."""
    user_id = _user_id_from_claims(current_user)

    try:
        file_row = await select_one("files", FILE_COLUMNS, {"id": file_id, "user_id": user_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if file_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    # Attempt DB delete using service role client but enforce user_id
    try:
        # Direct low-level delete to support removal; keep guard on user_id
        supabase = get_supabase()
        supabase.table("files").delete().eq("id", file_id).eq("user_id", user_id).execute()
        # remove local storage if present
        storage_path = file_row.get("storage_path")
        if storage_path:
            try:
                os.remove(storage_path)
            except Exception:
                logger.exception("Failed to remove local file at %s", storage_path)
    except Exception as exc:
        logger.exception("Failed to delete file: %s", exc)
        raise _database_error() from exc

    return None
