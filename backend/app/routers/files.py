from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
import os

from ..core.security import get_current_user
from ..schemas.chat import FileCreate, FileRead
from ..services.supabase_service import SupabaseServiceError, insert_one, select_all, select_one

router = APIRouter(prefix="/files", tags=["files"])
FILE_COLUMNS = "id,user_id,conversation_id,file_name,file_type,size_bytes,storage_path,metadata,created_at"
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
async def create_file_metadata(
    file_payload: FileCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)

    if file_payload.conversation_id:
        await _validate_conversation_ownership(file_payload.conversation_id, user_id)

    payload = {"user_id": user_id, **file_payload.model_dump(exclude_none=True)}

    try:
        return await insert_one("files", payload)
    except SupabaseServiceError as exc:
        raise _database_error() from exc


@router.get("", response_model=list[FileRead])
async def get_files(
    limit: int = Query(default=DEFAULT_FILE_LIMIT, ge=1, le=MAX_FILE_LIMIT),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)

    try:
        return await select_all(
            "files",
            FILE_COLUMNS,
            filters={"user_id": user_id},
            order_by="created_at",
            desc=True,
            limit=limit,
            offset=offset,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc


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
        resp = supabase.table("files").delete().eq("id", file_id).eq("user_id", user_id).execute()
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
