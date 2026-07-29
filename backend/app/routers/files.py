from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response

from ..core.security import get_current_user
from ..schemas.chat import FileCreate, FileRead, FileRetentionUpdate, FileVersionRead
from ..services.supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_one,
    select_all,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)
from ..services.file_storage import (
    StorageError,
    StorageNotFoundError,
    delete_storage_object,
    read_bytes_from_storage,
    sanitize_filename,
)
from ..services.workspace_service import (
    active_workspace_id_from_request,
    can_manage_workspace_resource,
    require_workspace_access,
)
from ..services.workspace_common import WorkspaceAccess
from ..services.workspace_collaboration_service import log_workspace_activity
from .conversations import require_conversation_access

router = APIRouter(prefix="/files", tags=["files"])
logger = logging.getLogger(__name__)
FILE_COLUMNS = (
    "id,user_id,workspace_id,conversation_id,file_name,file_type,size_bytes,storage_path,metadata,"
    "page_count,extractor_used,extracted_character_count,image_page_count,text_page_count,"
    "extraction_status,extraction_failure_reason,processing_status,processing_error,processing_job_id,"
    "ocr_used,ocr_character_count,retention_expires_at,lifecycle_status,created_at"
)
FILE_VERSION_COLUMNS = (
    "id,file_id,version_number,file_name,file_type,size_bytes,content_hash,storage_backend,"
    "lifecycle_status,cleanup_reason,created_at,cleanup_requested_at,cleaned_at"
)
FILE_LOCATOR_COLUMNS = "id,user_id,workspace_id"
DEFAULT_FILE_LIMIT = 50
MAX_FILE_LIMIT = 100
DEFAULT_FILE_VERSION_LIMIT = 50
MAX_FILE_VERSION_LIMIT = 100
MIN_FILE_RETENTION_DELAY = timedelta(minutes=5)


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


def _file_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="File not found.",
    )


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _retention_expiry_value(value: datetime | None) -> str | None:
    if value is None:
        return None

    if value.tzinfo is None or value.utcoffset() is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="retention_expires_at must include a timezone offset.",
        )
    normalized = value.astimezone(timezone.utc)
    if normalized < _utcnow() + MIN_FILE_RETENTION_DELAY:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="retention_expires_at must be at least 5 minutes in the future.",
        )
    return normalized.isoformat()


def _file_scope_filters(
    file_id: str,
    user_id: str,
    workspace_access: WorkspaceAccess | None,
) -> dict[str, Any]:
    if workspace_access is not None:
        return {
            "id": file_id,
            "workspace_id": workspace_access.workspace_id,
        }
    return {
        "id": file_id,
        "user_id": user_id,
        "workspace_id": {"is": None},
    }


async def _require_file_access(
    file_id: str,
    user_id: str,
) -> tuple[dict[str, Any], WorkspaceAccess | None]:
    try:
        locator = await select_one_trusted(
            "files",
            FILE_LOCATOR_COLUMNS,
            {"id": file_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if locator is None:
        raise _file_not_found()

    workspace_access: WorkspaceAccess | None = None
    workspace_id = locator.get("workspace_id")
    if workspace_id:
        try:
            workspace_access = await require_workspace_access(str(workspace_id), user_id)
        except HTTPException as exc:
            if exc.status_code in {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND}:
                raise _file_not_found() from exc
            raise
    elif str(locator.get("user_id") or "") != user_id:
        raise _file_not_found()

    try:
        file_row = await select_one_trusted(
            "files",
            FILE_COLUMNS,
            _file_scope_filters(file_id, user_id, workspace_access),
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if file_row is None:
        raise _file_not_found()

    return file_row, workspace_access


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
        access = await require_workspace_access(effective_workspace_id, user_id)
        effective_workspace_id = access.workspace_id

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

        filters = {"user_id": user_id, "workspace_id": {"is": None}}
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


@router.get("/{file_id}", response_model=FileRead)
async def get_file(
    file_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    file_row, _ = await _require_file_access(
        file_id,
        _user_id_from_claims(current_user),
    )
    return {**file_row, "storage_path": None}


@router.get("/{file_id}/versions", response_model=list[FileVersionRead])
async def get_file_versions(
    file_id: str,
    limit: int = Query(default=DEFAULT_FILE_VERSION_LIMIT, ge=1, le=MAX_FILE_VERSION_LIMIT),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    await _require_file_access(file_id, user_id)

    try:
        rows = await select_all_trusted(
            "file_versions",
            FILE_VERSION_COLUMNS,
            filters={"file_id": file_id},
            order_by="version_number",
            desc=True,
            limit=limit,
            offset=offset,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    return [FileVersionRead.model_validate(row).model_dump() for row in rows]


@router.patch("/{file_id}/retention", response_model=FileRead)
async def update_file_retention(
    file_id: str,
    retention: FileRetentionUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    file_row, workspace_access = await _require_file_access(file_id, user_id)

    uploader_user_id = str(file_row.get("user_id") or "")
    if (
        workspace_access is not None
        and uploader_user_id != user_id
        and not can_manage_workspace_resource(uploader_user_id, workspace_access, user_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the uploader or workspace owner can manage file retention.",
        )

    if file_row.get("lifecycle_status") == "retention_pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="File retention expiry is already in progress.",
        )

    retention_expires_at = _retention_expiry_value(retention.retention_expires_at)
    filters = _file_scope_filters(file_id, user_id, workspace_access)
    filters["lifecycle_status"] = "active"

    try:
        updated = await update_one_trusted(
            "files",
            filters,
            {"retention_expires_at": retention_expires_at},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="File lifecycle changed while retention was being updated.",
        )

    if workspace_access is not None:
        await log_workspace_activity(
            workspace_id=workspace_access.workspace_id,
            actor_user_id=user_id,
            event_type="workspace.source_retention_updated",
            summary=(
                f"Retention was scheduled for {file_row.get('file_name') or 'a source'}."
                if retention_expires_at is not None
                else f"Retention was cleared for {file_row.get('file_name') or 'a source'}."
            ),
            metadata={
                "file_id": file_id,
                "retention_expires_at": retention_expires_at,
            },
        )

    return {**file_row, **updated}


@router.get("/{file_id}/download")
async def download_file(
    file_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    user_id = _user_id_from_claims(current_user)
    file_row, _ = await _require_file_access(file_id, user_id)

    storage_path = file_row.get("storage_path")
    try:
        data = await read_bytes_from_storage(storage_path)
    except StorageNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File content not found on server.")
    except StorageError as exc:
        raise _database_error() from exc

    filename = sanitize_filename(file_row.get("file_name") or "download", fallback="download")
    file_type = file_row.get("file_type") or "application/octet-stream"
    return Response(
        content=data,
        media_type=file_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
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

    storage_missing = False
    storage_path = file_row.get("storage_path")
    if storage_path:
        try:
            deleted = await delete_storage_object(storage_path)
        except StorageError as exc:
            raise _database_error() from exc
        if not deleted:
            logger.warning(
                "Physical file already missing for file_id=%s path=%s",
                file_id, storage_path,
            )
            storage_missing = True

    document_filters: dict[str, Any] = {"file_id": file_id}
    if workspace_access is not None:
        workspace_id = workspace_access.workspace_id
        document_filters["workspace_id"] = workspace_id
    else:
        workspace_id = None
        document_filters["user_id"] = user_id
        document_filters["workspace_id"] = {"is": None}

    try:
        await delete_many_trusted("documents", document_filters)
        await delete_many_trusted(
            "files",
            _file_scope_filters(file_id, user_id, workspace_access),
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if workspace_id:
        await log_workspace_activity(
            workspace_id=str(workspace_id),
            actor_user_id=user_id,
            event_type="workspace.source_removed",
            summary=f"{file_row.get('file_name') or 'A source'} was removed from the workspace.",
            metadata={"file_id": file_id},
        )

    if storage_missing:
        return JSONResponse(
            content={"storage_missing": True},
            status_code=200,
        )
    return Response(status_code=204)
