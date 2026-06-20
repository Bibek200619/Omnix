from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status

from ..core.security import get_current_user
from ..services.document_intelligence_service import (
    ExtractionDiagnostics,
    extract_document_with_diagnostics,
    extraction_columns_payload,
)
from ..services.supabase_service import SupabaseServiceError, insert_one, update_one
from ..services.document_context_service import store_extracted_text_chunks
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


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_text_from_bytes(filename: str, file_type: str | None, data: bytes) -> str:
    return extract_document_with_diagnostics(filename, file_type, data).text


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
        if not any(column in message for column in diagnostic_columns):
            raise
        logger.warning("File diagnostics columns are unavailable; inserting file metadata without physical diagnostics columns.")
        fallback_payload = {key: value for key, value in payload.items() if key not in diagnostic_columns}
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
    filename = sanitize_filename(file.filename or "unnamed")
    if file_type not in ALLOWED_MIMES and not any(filename.lower().endswith(ext) for ext in (".pdf", ".docx", ".txt", ".md")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")

    # Save raw file to disk
    try:
        storage_path = await save_bytes_to_user_upload(user_id, filename, contents, root=UPLOAD_DIR)
        logger.info("Document uploaded")
    except Exception as exc:
        logger.exception("Failed to persist uploaded file to disk: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store file")

    processing_diagnostics = ExtractionDiagnostics(extraction_status="processing")

    # Persist file metadata to files table
    payload = {
        "file_name": filename,
        "file_type": file_type or None,
        "size_bytes": size,
        "storage_path": storage_path,
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

    extraction_result = await asyncio.to_thread(extract_document_with_diagnostics, filename, file_type, contents)
    normalized = extraction_result.text
    diagnostics = extraction_result.diagnostics
    metadata = _metadata_with_diagnostics(preview=normalized, diagnostics=diagnostics)
    update_payload = {
        "metadata": metadata,
        **extraction_columns_payload(diagnostics),
    }
    try:
        updated_file = await update_one("files", {"id": str(file_row["id"]), "user_id": user_id}, update_payload)
        if updated_file:
            file_row = updated_file
        else:
            file_row.update(update_payload)
    except SupabaseServiceError:
        logger.warning("File diagnostics columns may be unavailable; retrying metadata-only diagnostics update.")
        try:
            updated_file = await update_one("files", {"id": str(file_row["id"]), "user_id": user_id}, {"metadata": metadata})
            if updated_file:
                file_row = updated_file
            else:
                file_row["metadata"] = metadata
        except SupabaseServiceError as exc:
            logger.exception("Failed to persist extraction diagnostics: %s", exc)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to persist extraction diagnostics")

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
                "extraction_status": diagnostics.extraction_status,
                "extracted_character_count": diagnostics.extracted_character_count,
                "ocr_used": diagnostics.ocr_used,
            },
        )

    # Persist lightweight chunks immediately so chat can use the upload even if
    # Redis, the worker, or embedding generation is delayed on the EC2 host.
    if diagnostics.extraction_status == "searchable" and normalized:
        try:
            stored_chunks = await store_extracted_text_chunks(
                file_id=str(file_row.get("id")),
                user_id=user_id,
                text=normalized,
                workspace_id=workspace_id,
                replace_existing=True,
            )
            metadata = dict(file_row.get("metadata") or {})
            metadata.update(
                {
                    "text_chunk_count": stored_chunks.chunk_count,
                    "text_chunks_truncated": stored_chunks.truncated,
                }
            )
            file_row["metadata"] = metadata
            try:
                await update_one("files", {"id": str(file_row["id"]), "user_id": user_id}, {"metadata": metadata})
            except SupabaseServiceError:
                logger.warning("Unable to persist immediate chunk diagnostics for file %s.", file_row.get("id"))
            logger.info("Chunks created")
        except Exception:
            logger.exception("Failed to persist immediate text chunks for file %s.", file_row.get("id"))

    # Enqueue ingestion job to add embeddings asynchronously. Chat still works
    # through keyword/fallback retrieval if this background path is unavailable.
    try:
        from ..jobs.queue import enqueue_job
        await enqueue_job({"type": "ingest_file", "file_id": str(file_row.get("id")), "user_id": user_id, "workspace_id": workspace_id})
    except Exception:
        logger.exception("Failed to enqueue ingestion job; continuing without background processing.")

    # Return the stored file record immediately; ingestion will occur in background
    return file_row
