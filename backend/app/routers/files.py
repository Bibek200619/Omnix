from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse

from ..core.security import get_current_user
from ..schemas.chat import FileCreate, FileRead
from ..services.supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_one,
    select_all,
    select_all_trusted,
    select_one_trusted,
)
from ..services.file_storage import resolve_managed_storage_path, sanitize_filename
from ..services.workspace_service import (
    active_workspace_id_from_request,
    can_manage_workspace_resource,
    require_workspace_access,
)
from ..services.workspace_collaboration_service import log_workspace_activity
from .conversations import require_conversation_access

router = APIRouter(prefix="/files", tags=["files"])
FILE_COLUMNS = (
    "id,user_id,workspace_id,conversation_id,file_name,file_type,size_bytes,storage_path,metadata,"
    "page_count,extractor_used,extracted_character_count,image_page_count,text_page_count,"
    "extraction_status,extraction_failure_reason,ocr_used,ocr_character_count,created_at"
)
DEFAULT_FILE_LIMIT = 50
MAX_FILE_LIMIT = 100


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


async def _require_file_access(
    file_id: str,
    user_id: str,
) -> tuple[dict[str, Any], Any | None]:
    try:
        file_row = await select_one_trusted("files", FILE_COLUMNS, {"id": file_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if file_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")

    workspace_id = file_row.get("workspace_id")
    if workspace_id:
        access = await require_workspace_access(str(workspace_id), user_id)
        return file_row, access

    if str(file_row.get("user_id") or "") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")

    return file_row, None


async def _resolve_effective_workspace_id(
    request: Request,
    user_id: str,
    conversation_id: str | None,
    workspace_id: str | None,
) -> str | None:
    effective_workspace_id = workspace_id or active_workspace_id_from_request(request)

    if conversation_id:
        conversation, _ = await require_conversation_access(conversation_id, user_id)
        conversation_workspace_id = str(conversation.get("workspace_id") or "") or None
        if effective_workspace_id and conversation_workspace_id and effective_workspace_id != conversation_workspace_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Conversation and workspace scope do not match.",
            )
        effective_workspace_id = conversation_workspace_id

    if effective_workspace_id:
        await require_workspace_access(effective_workspace_id, user_id)

    return effective_workspace_id


@router.post("", response_model=FileRead, status_code=status.HTTP_201_CREATED)
async def create_file_metadata(
    file_payload: FileCreate,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    effective_workspace_id = await _resolve_effective_workspace_id(
        request,
        user_id,
        file_payload.conversation_id,
        file_payload.workspace_id,
    )

    payload = {"user_id": user_id, **file_payload.model_dump(exclude_none=True)}
    if effective_workspace_id:
        payload["workspace_id"] = effective_workspace_id

    try:
        created = await insert_one("files", payload)
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if effective_workspace_id:
        await log_workspace_activity(
            workspace_id=effective_workspace_id,
            actor_user_id=user_id,
            event_type="workspace.source_connected",
            summary=f"{created.get('file_name') or 'A source'} was connected to the workspace.",
            metadata={
                "file_id": str(created.get("id") or ""),
                "file_type": created.get("file_type"),
                "size_bytes": created.get("size_bytes"),
            },
        )

    return created


@router.get("", response_model=list[FileRead])
async def get_files(
    request: Request,
    limit: int = Query(default=DEFAULT_FILE_LIMIT, ge=1, le=MAX_FILE_LIMIT),
    offset: int = Query(default=0, ge=0),
    conversation_id: str | None = Query(default=None),
    workspace_id: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    effective_workspace_id = await _resolve_effective_workspace_id(
        request,
        user_id,
        conversation_id,
        workspace_id,
    )

    try:
        if effective_workspace_id:
            filters: dict[str, Any] = {"workspace_id": effective_workspace_id}
            if conversation_id is not None:
                filters["conversation_id"] = conversation_id
            return await select_all_trusted(
                "files",
                FILE_COLUMNS,
                filters=filters,
                order_by="created_at",
                desc=True,
                limit=limit,
                offset=offset,
            )

        filters = {"user_id": user_id}
        if conversation_id is not None:
            filters["conversation_id"] = conversation_id
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
    file_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> FileResponse:
    user_id = _user_id_from_claims(current_user)
    file_row, _ = await _require_file_access(file_id, user_id)

    storage_path = file_row.get("storage_path")
    safe_path = resolve_managed_storage_path(storage_path)
    if safe_path is None or not safe_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File content not found on server.")

    filename = sanitize_filename(file_row.get("file_name") or "download", fallback="download")
    file_type = file_row.get("file_type") or "application/octet-stream"
    return FileResponse(path=safe_path, filename=filename, media_type=file_type)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    file_row, workspace_access = await _require_file_access(file_id, user_id)

    if workspace_access is not None and not can_manage_workspace_resource(
        str(file_row.get("user_id") or ""),
        workspace_access,
        user_id,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the uploader or workspace owner can delete this file.",
        )

    try:
        await delete_many_trusted("files", {"id": file_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if file_row.get("workspace_id"):
        await log_workspace_activity(
            workspace_id=str(file_row["workspace_id"]),
            actor_user_id=user_id,
            event_type="workspace.source_removed",
            summary=f"{file_row.get('file_name') or 'A source'} was removed from the workspace.",
            metadata={"file_id": file_id},
        )

    storage_path = file_row.get("storage_path")
    if storage_path:
        safe_path = resolve_managed_storage_path(storage_path)
        if safe_path is not None:
            try:
                safe_path.unlink()
            except FileNotFoundError:
                pass
            except Exception as exc:
                raise _database_error() from exc

    return None
