from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status

from ..jobs import queue as job_queue
from ..core.security import get_current_user
from ..services.document_intelligence_service import (
    ExtractionDiagnostics,
    extraction_columns_payload,
)
from ..services.supabase_service import SupabaseServiceError, insert_one, update_one
from ..services.file_storage import sanitize_filename, save_bytes_to_user_upload
from ..services.workspace_service import active_workspace_id_from_request, require_workspace_access
from ..services.workspace_collaboration_service import log_workspace_activity
from .conversations import require_conversation_access

logger = logging.getLogger(__name__)

router = APIRouter()

# Limit to 25 MB per file
MAX_UPLOAD_SIZE = int(os.environ.get("OMNIX_MAX_UPLOAD_BYTES", 25 * 1024 * 1024))
ALLOWED_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
}

UPLOAD_DIR = os.environ.get("OMNIX_UPLOAD_DIR", "./uploads")
PROCESSING_COLUMNS = {"processing_status", "processing_error", "processing_job_id"}
EXTENSION_WHITELIST = {".pdf", ".docx", ".txt", ".md"}
_DANGEROUS_MAGIC = [
    b"MZ",       # PE/EXE
    b"\x7fELF",  # ELF binary
]


def _validate_content_type(contents: bytes, filename: str) -> None:
    """Reject uploads where file content does not match the declared extension."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in EXTENSION_WHITELIST:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")

    # Block dangerous binary content masquerading as safe files
    for magic in _DANGEROUS_MAGIC:
        if contents[: len(magic)] == magic:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match declared type.",
            )

    # Validate magic bytes for known binary formats
    if ext == ".pdf" and not contents[:5].startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match declared type.",
        )
    if ext == ".docx" and contents[:2] != b"PK":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match declared type.",
        )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _metadata_with_diagnostics(
    *,
    preview: str = "",
    diagnostics: ExtractionDiagnostics,
    processing_status: str | None = None,
    processing_error: str | None = None,
    processing_job_id: str | None = None,
) -> dict[str, Any]:
    metadata = {
        "extracted_text_preview": preview[:2000],
        **diagnostics.to_metadata(),
    }
    if processing_status:
        metadata["processing_status"] = processing_status
    if processing_error:
        metadata["processing_error"] = processing_error
    if processing_job_id:
        metadata["processing_job_id"] = processing_job_id
    if diagnostics.extraction_failure_reason:
        metadata["extraction_error"] = diagnostics.extraction_failure_reason
    return metadata


async def _insert_file_row(payload: dict[str, Any], user_id: str) -> dict[str, Any]:
    try:
        return await insert_one("files", {"user_id": user_id, **payload})
    except SupabaseServiceError as exc:
        message = str(exc.__cause__ or exc).lower()
        optional_columns = set(ExtractionDiagnostics().__dataclass_fields__) | PROCESSING_COLUMNS
        if not any(column in message for column in optional_columns):
            raise
        logger.warning("File status columns are unavailable; inserting file metadata without physical status columns.")
        fallback_payload = {key: value for key, value in payload.items() if key not in optional_columns}
        return await insert_one("files", {"user_id": user_id, **fallback_payload})


async def _update_file_processing_state(
    *,
    file_row: dict[str, Any],
    user_id: str,
    processing_status: str,
    processing_error: str | None = None,
    processing_job_id: str | None = None,
) -> dict[str, Any]:
    metadata = dict(file_row.get("metadata") or {})
    metadata.update({"processing_status": processing_status})
    if processing_error:
        metadata["processing_error"] = processing_error
    else:
        metadata.pop("processing_error", None)
    if processing_job_id:
        metadata["processing_job_id"] = processing_job_id

    payload = {
        "metadata": metadata,
        "processing_status": processing_status,
        "processing_error": processing_error,
        "processing_job_id": processing_job_id,
    }
    try:
        updated = await update_one("files", {"id": str(file_row["id"]), "user_id": user_id}, payload)
        if updated:
            return updated
        return {**file_row, **payload}
    except SupabaseServiceError:
        logger.warning("File processing columns are unavailable; retrying processing update as metadata only.")
        try:
            updated = await update_one("files", {"id": str(file_row["id"]), "user_id": user_id}, {"metadata": metadata})
            if updated:
                return updated
        except SupabaseServiceError as exc:
            logger.exception("Failed to persist file processing state: %s", exc)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to persist file processing state")
        return {**file_row, "metadata": metadata}


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    conversation_id: str | None = Form(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Accept file uploads, store file metadata, and enqueue asynchronous processing.

    Returns the created file metadata row.
    """
    user_id = str(current_user["sub"])

    workspace_id = active_workspace_id_from_request(request)
    if conversation_id:
        conversation, _ = await require_conversation_access(conversation_id, user_id)
        conversation_workspace_id = str(conversation.get("workspace_id") or "") or None
        if workspace_id and conversation_workspace_id and workspace_id != conversation_workspace_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Conversation and workspace scope do not match.",
            )
        workspace_id = conversation_workspace_id

    if workspace_id:
        await require_workspace_access(workspace_id, user_id)

    # Read bytes and validate size
    contents = await file.read()
    size = len(contents)
    if size == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if size > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds the limit of {MAX_UPLOAD_SIZE} bytes",
        )

    # Validate mime/extension
    file_type = (file.content_type or "").lower()
    filename = sanitize_filename(file.filename or "unnamed")
    if file_type not in ALLOWED_MIMES and not any(filename.lower().endswith(ext) for ext in (".pdf", ".docx", ".txt", ".md")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")

    # Content-based MIME validation: reject disguised executables
    _validate_content_type(contents, filename)

    # Save raw file through the configured storage backend.
    try:
        storage_path = await save_bytes_to_user_upload(user_id, filename, contents, root=UPLOAD_DIR, content_type=file_type or None)
        logger.info("Document uploaded")
    except Exception as exc:
        logger.exception("Failed to persist uploaded file: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store file")

    processing_diagnostics = ExtractionDiagnostics(extraction_status="processing")

    # Persist file metadata to files table
    payload = {
        "file_name": filename,
        "file_type": file_type or None,
        "size_bytes": size,
        "storage_path": storage_path,
        "metadata": _metadata_with_diagnostics(diagnostics=processing_diagnostics, processing_status="uploaded"),
        "conversation_id": conversation_id,
        "processing_status": "uploaded",
        "processing_error": None,
        "processing_job_id": None,
        **extraction_columns_payload(processing_diagnostics),
    }
    if workspace_id:
        payload["workspace_id"] = workspace_id

    try:
        file_row = await _insert_file_row(payload, user_id)
    except SupabaseServiceError as exc:
        logger.exception("Failed to insert file metadata: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to register file")

    try:
        job_id = await job_queue.enqueue_job(
            {"type": "ingest_file", "file_id": str(file_row.get("id")), "user_id": user_id, "workspace_id": workspace_id}
        )
        file_row = await _update_file_processing_state(
            file_row=file_row,
            user_id=user_id,
            processing_status="queued",
            processing_job_id=job_id,
        )
    except job_queue.JobEnqueueError as exc:
        if exc.persisted:
            queue_warning = "Background processing was queued, but the worker queue is temporarily unavailable."
            file_row = await _update_file_processing_state(
                file_row=file_row,
                user_id=user_id,
                processing_status="queued",
                processing_error=queue_warning,
                processing_job_id=exc.job_id,
            )
        else:
            logger.exception("Failed to persist file ingestion job for file %s.", file_row.get("id"))
            file_row = await _update_file_processing_state(
                file_row=file_row,
                user_id=user_id,
                processing_status="failed",
                processing_error="File processing could not be queued. Please retry the upload.",
            )
    except Exception:
        logger.exception("Failed to enqueue ingestion job for file %s.", file_row.get("id"))
        file_row = await _update_file_processing_state(
            file_row=file_row,
            user_id=user_id,
            processing_status="failed",
            processing_error="File processing could not be queued. Please retry the upload.",
        )

    if workspace_id:
        await log_workspace_activity(
            workspace_id=workspace_id,
            actor_user_id=user_id,
            event_type="workspace.source_uploaded",
            summary=f"{filename} was uploaded as a workspace source.",
            metadata={
                "file_id": str(file_row.get("id") or ""),
                "file_type": file_type or None,
                "size_bytes": size,
                "conversation_id": conversation_id,
                "processing_status": file_row.get("processing_status") or (file_row.get("metadata") or {}).get("processing_status"),
                "processing_job_id": file_row.get("processing_job_id") or (file_row.get("metadata") or {}).get("processing_job_id"),
                "processing_error": file_row.get("processing_error") or (file_row.get("metadata") or {}).get("processing_error"),
            },
        )

    return file_row
