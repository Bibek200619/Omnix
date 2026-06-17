from __future__ import annotations

import hashlib
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status

from ..core.security import get_current_user
from ..services.document_intelligence_service import (
    ExtractionDiagnostics,
    extract_document_with_diagnostics,
    extraction_columns_payload,
)
from ..services.supabase_service import SupabaseServiceError, insert_one, select_one_trusted
from ..services.document_context_service import (
    LOCAL_STORAGE_BACKEND,
    configured_file_storage_backend,
    supabase_storage_object_path,
    upload_bytes_to_supabase_storage,
)
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
TEXT_EXTENSIONS = (".txt", ".md")
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

UPLOAD_DIR = os.environ.get("OMNIX_UPLOAD_DIR", "./uploads")
FILE_DEDUPE_COLUMNS = (
    "id,user_id,workspace_id,conversation_id,file_name,file_type,size_bytes,"
    "storage_path,storage_backend,metadata,content_hash,created_at"
)


@dataclass(slots=True)
class StoredUpload:
    storage_path: str
    storage_backend: str


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _save_bytes_to_path(user_id: str, filename: str, data: bytes) -> str:
    user_dir = os.path.join(UPLOAD_DIR, user_id)
    os.makedirs(user_dir, exist_ok=True)
    unique_name = f"{uuid.uuid4().hex}_{filename}"
    path = os.path.join(user_dir, unique_name)
    with open(path, "wb") as fh:
        fh.write(data)
    return path


async def _store_upload_bytes(
    *,
    user_id: str,
    filename: str,
    data: bytes,
    file_type: str | None,
) -> StoredUpload:
    if configured_file_storage_backend() == LOCAL_STORAGE_BACKEND:
        return StoredUpload(
            storage_path=await _save_bytes_to_path(user_id, filename, data),
            storage_backend=LOCAL_STORAGE_BACKEND,
        )

    storage_path = supabase_storage_object_path(user_id, filename)
    await upload_bytes_to_supabase_storage(storage_path, data, content_type=file_type)
    return StoredUpload(storage_path=storage_path, storage_backend="supabase")


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _extract_text_from_bytes(filename: str, file_type: str | None, data: bytes) -> str:
    return extract_document_with_diagnostics(filename, file_type, data).text


def _content_hash_column_missing(exc: SupabaseServiceError) -> bool:
    message = str(exc.__cause__ or exc).lower()
    return "content_hash" in message and "does not exist" in message


async def _find_duplicate_file(
    *,
    content_hash: str,
    user_id: str,
    workspace_id: str | None,
) -> dict[str, Any] | None:
    filters: dict[str, Any] = {"content_hash": content_hash}
    if workspace_id:
        filters["workspace_id"] = workspace_id
    else:
        filters["user_id"] = user_id
        filters["workspace_id"] = {"is": None}

    try:
        return await select_one_trusted("files", FILE_DEDUPE_COLUMNS, filters)
    except SupabaseServiceError as exc:
        if _content_hash_column_missing(exc):
            logger.warning("files.content_hash is unavailable; upload deduplication skipped.")
            return None
        raise


def _deduplicated_file_response(file_row: dict[str, Any]) -> dict[str, Any]:
    return {
        **file_row,
        "status": "deduplicated",
        "file_id": str(file_row.get("id") or ""),
    }


def _validate_upload_content(*, filename: str, file_type: str | None, data: bytes) -> None:
    lower_name = filename.lower()
    normalized_type = (file_type or "").lower()

    if normalized_type == "application/pdf" or lower_name.endswith(".pdf"):
        if not data.startswith(b"%PDF"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File content does not match PDF type.")
        return

    if normalized_type == DOCX_MIME or lower_name.endswith(".docx"):
        if not data.startswith(b"PK"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File content does not match DOCX type.")
        return

    if normalized_type in {"text/plain", "text/markdown", "text/x-markdown"} or lower_name.endswith(TEXT_EXTENSIONS):
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File content does not match text type.") from exc
        if b"\x00" in data[:4096]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File content does not match text type.")


def _metadata_with_diagnostics(
    *,
    preview: str = "",
    diagnostics: ExtractionDiagnostics,
) -> dict[str, Any]:
    metadata = {
        "extracted_text_preview": preview[:2000],
        **diagnostics.to_metadata(),
    }
    if diagnostics.extraction_failure_reason:
        metadata["extraction_error"] = diagnostics.extraction_failure_reason
    return metadata


async def _insert_file_row(payload: dict[str, Any], user_id: str) -> dict[str, Any]:
    try:
        return await insert_one("files", {"user_id": user_id, **payload})
    except SupabaseServiceError as exc:
        message = str(exc.__cause__ or exc).lower()
        diagnostic_columns = set(ExtractionDiagnostics().__dataclass_fields__)
        optional_columns = diagnostic_columns | {"storage_backend", "content_hash"}
        if not any(column in message for column in optional_columns):
            raise
        logger.warning("Optional file columns are unavailable; inserting file metadata without them.")
        fallback_payload = {key: value for key, value in payload.items() if key not in optional_columns}
        return await insert_one("files", {"user_id": user_id, **fallback_payload})


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    conversation_id: str | None = Form(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Accept file uploads, extract text, store file metadata, and split into document chunks.

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
    filename = os.path.basename(file.filename or "unnamed")
    if file_type not in ALLOWED_MIMES and not any(filename.lower().endswith(ext) for ext in (".pdf", ".docx", ".txt", ".md")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")
    _validate_upload_content(filename=filename, file_type=file_type or None, data=contents)
    content_hash = _sha256_hex(contents)

    try:
        duplicate_file = await _find_duplicate_file(
            content_hash=content_hash,
            user_id=user_id,
            workspace_id=workspace_id,
        )
    except SupabaseServiceError as exc:
        logger.exception("Failed to check duplicate file metadata: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to check duplicate file")

    if duplicate_file is not None:
        return _deduplicated_file_response(duplicate_file)

    # Store raw file bytes
    try:
        stored_upload = await _store_upload_bytes(
            user_id=user_id,
            filename=filename,
            data=contents,
            file_type=file_type or None,
        )
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
        "storage_path": stored_upload.storage_path,
        "storage_backend": stored_upload.storage_backend,
        "content_hash": content_hash,
        "metadata": _metadata_with_diagnostics(diagnostics=processing_diagnostics),
        "conversation_id": conversation_id,
        **extraction_columns_payload(processing_diagnostics),
    }
    if workspace_id:
        payload["workspace_id"] = workspace_id

    try:
        file_row = await _insert_file_row(payload, user_id)
    except SupabaseServiceError as exc:
        logger.exception("Failed to insert file metadata: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to register file")

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
                "extraction_status": processing_diagnostics.extraction_status,
                "extracted_character_count": processing_diagnostics.extracted_character_count,
                "ocr_used": processing_diagnostics.ocr_used,
            },
        )

    # Enqueue ingestion job to add embeddings asynchronously. Chat still works
    # through keyword/fallback retrieval if this background path is unavailable.
    try:
        from ..jobs.queue import enqueue_job
        await enqueue_job({"type": "ingest_file", "file_id": str(file_row.get("id")), "user_id": user_id, "workspace_id": workspace_id})
    except Exception:
        logger.exception("Failed to enqueue ingestion job; continuing without background processing.")

    # Return the stored file record immediately; ingestion will occur in background
    return file_row
