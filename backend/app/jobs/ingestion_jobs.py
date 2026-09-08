from __future__ import annotations

import asyncio
import logging
from typing import Any
from datetime import datetime, timezone

from ..services.file_storage import StorageNotFoundError, read_bytes_from_storage
from ..services.supabase_service import (
    select_one_trusted,
    update_one_trusted,
)
from ..services.document_intelligence_service import (
    ExtractionDiagnostics,
    document_likely_requires_ocr,
    extract_document_with_diagnostics,
    extraction_columns_payload,
)
from ..services.document_context_service import store_extracted_text_chunks
from ..rag.startup import get_vector_store
from ..rag.ingestion import RAGIngestionPipeline

logger = logging.getLogger(__name__)

_PARTIAL_INDEXING_ERROR = (
    "Text extraction succeeded, but vector indexing is temporarily unavailable. "
    "The source is only partially searchable and will be retried."
)
_PROCESSING_STATE_ERROR = "Unable to save file processing state. Please retry."


def _unsearchable_processing_status(diagnostics: ExtractionDiagnostics) -> str:
    if diagnostics.extraction_status == "ocr_required":
        return "ocr_required"
    return "failed"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _metadata_with_processing(
    file_row: dict[str, Any],
    *,
    processing_status: str,
    processing_error: str | None = None,
    updates: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = dict(file_row.get("metadata") or {})
    metadata.update(updates or {})
    metadata["processing_status"] = processing_status
    if processing_error:
        metadata["processing_error"] = processing_error
    else:
        metadata.pop("processing_error", None)
    if file_row.get("processing_job_id"):
        metadata["processing_job_id"] = str(file_row["processing_job_id"])
    return metadata


def _file_scope_filters(file_id: str, user_id: str, workspace_id: str | None) -> dict[str, Any]:
    filters: dict[str, Any] = {"id": file_id, "user_id": user_id}
    filters["workspace_id"] = workspace_id if workspace_id else {"is": None}
    return filters


async def _update_file_processing_state(
    file_id: str,
    file_row: dict[str, Any],
    *,
    user_id: str,
    workspace_id: str | None,
    processing_status: str,
    processing_error: str | None = None,
    metadata_updates: dict[str, Any] | None = None,
    diagnostics_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = _metadata_with_processing(
        file_row,
        processing_status=processing_status,
        processing_error=processing_error,
        updates=metadata_updates,
    )
    payload = {
        "metadata": metadata,
        "processing_status": processing_status,
        "processing_error": processing_error,
        **(diagnostics_payload or {}),
    }
    filters = _file_scope_filters(file_id, user_id, workspace_id)
    try:
        updated = await update_one_trusted("files", filters, payload)
    except Exception:
        # A metadata-only fallback would leave the canonical processing state stale.
        # Suppress database exception details before the job handler logs the failure.
        raise RuntimeError(_PROCESSING_STATE_ERROR) from None
    if not updated:
        # The scoped file may have disappeared; never fabricate persistence success.
        raise RuntimeError(_PROCESSING_STATE_ERROR)
    return updated


async def handle_ingest_file(job_row: dict[str, Any]) -> dict[str, Any]:
    """Process an ingestion job created after file upload. Expects payload in job_row['payload']."""
    file_id: str | None = None
    user_id: str | None = None
    workspace_id: str | None = None
    file_row: dict[str, Any] | None = None
    try:
        import json
        payload = job_row.get("payload")
        if isinstance(payload, str):
            payload = json.loads(payload)
        file_id = payload.get("file_id")
        user_id = payload.get("user_id")
        workspace_id = payload.get("workspace_id")
        if not file_id or not user_id:
            raise ValueError("Invalid ingest job payload")

        # Fetch file metadata
        FILE_COLUMNS = (
            "id,user_id,workspace_id,file_name,file_type,size_bytes,storage_path,metadata,"
            "page_count,extractor_used,extracted_character_count,image_page_count,text_page_count,"
            "extraction_status,extraction_failure_reason,processing_status,processing_error,processing_job_id,"
            "ocr_used,ocr_character_count,created_at"
        )
        file_row = await select_one_trusted("files", FILE_COLUMNS, _file_scope_filters(file_id, user_id, workspace_id))
        if file_row is None:
            raise RuntimeError("File not found for ingestion")

        file_row = await _update_file_processing_state(
            file_id,
            file_row,
            user_id=user_id,
            workspace_id=workspace_id,
            processing_status="extracting",
        )

        filename = file_row.get("file_name") or "imported"
        file_type = file_row.get("file_type")

        try:
            data = await read_bytes_from_storage(file_row.get("storage_path"))
        except StorageNotFoundError as exc:
            raise RuntimeError("Stored file not found in storage") from exc

        if document_likely_requires_ocr(filename, file_type, data):
            file_row = await _update_file_processing_state(
                file_id,
                file_row,
                user_id=user_id,
                workspace_id=workspace_id,
                processing_status="ocr_running",
            )

        extraction_result = await asyncio.to_thread(extract_document_with_diagnostics, filename, file_type, data)
        normalized = extraction_result.text
        diagnostics = extraction_result.diagnostics
        metadata = dict(file_row.get("metadata") or {})
        metadata.update({"extracted_text_preview": normalized[:2000], **diagnostics.to_metadata()})
        if diagnostics.extraction_failure_reason:
            metadata["extraction_error"] = diagnostics.extraction_failure_reason

        if diagnostics.extraction_status != "searchable" or not normalized:
            processing_error = diagnostics.extraction_failure_reason or "No searchable text was extracted from this file."
            processing_status = _unsearchable_processing_status(diagnostics)
            await _update_file_processing_state(
                file_id,
                file_row,
                user_id=user_id,
                workspace_id=workspace_id,
                processing_status=processing_status,
                processing_error=processing_error,
                metadata_updates=metadata,
                diagnostics_payload=extraction_columns_payload(diagnostics),
            )
            return {
                "status": "completed" if processing_status == "ocr_required" else "failed",
                "file_status": diagnostics.extraction_status,
                "processing_status": processing_status,
                "error": processing_error,
                "chunks": [],
            }

        file_row = await _update_file_processing_state(
            file_id,
            file_row,
            user_id=user_id,
            workspace_id=workspace_id,
            processing_status="chunking",
            metadata_updates=metadata,
            diagnostics_payload=extraction_columns_payload(diagnostics),
        )
        stored_chunks = await store_extracted_text_chunks(
            file_id=file_id,
            user_id=user_id,
            text=normalized,
            workspace_id=workspace_id,
            replace_existing=True,
        )
        file_row = await _update_file_processing_state(
            file_id,
            file_row,
            user_id=user_id,
            workspace_id=workspace_id,
            processing_status="embedding",
            metadata_updates={
                **metadata,
                "text_chunk_count": stored_chunks.chunk_count,
                "text_chunks_truncated": stored_chunks.truncated,
                "vector_index_status": "pending",
            },
            diagnostics_payload=extraction_columns_payload(diagnostics),
        )

        # Run ingestion pipeline (chunks, embeddings, DB insert)
        try:
            try:
                vector_store = get_vector_store()
            except RuntimeError as e:
                logger.error("Vector store not initialized in ingestion worker: %s", e)
                raise RuntimeError("Vector store unavailable in worker runtime. Ensure worker startup initialized retrieval infrastructure.") from e

            # validate embedding provider early (gives actionable error if misconfigured)
            try:
                from ..embeddings.provider import warm_up_default_provider  # local import to avoid cycles

                provider = await warm_up_default_provider()
                logger.debug("Embedding provider available in ingestion job: %s", provider.__class__.__name__)
            except Exception as e:
                logger.error("Embedding provider not available: %s", e)
                raise RuntimeError(
                    "Local embeddings provider is unavailable in the worker runtime. "
                    "Install sentence-transformers/torch and ensure the local model is cached or reachable."
                ) from e

            pipeline = RAGIngestionPipeline(vector_store)
            if str(filename).lower().endswith(".pdf") or "pdf" in (file_type or "").lower():
                source_type = "pdf"
            elif "word" in (file_type or "").lower() or str(filename).lower().endswith(".docx"):
                source_type = "docx"
            else:
                source_type = "text"
            num, chunk_ids = await pipeline.ingest_text(
                normalized,
                user_id,
                document_id=file_id,
                workspace_id=workspace_id,
                metadata={"filename": filename, "content_type": file_type, **diagnostics.to_metadata()},
                source_type=source_type,
                replace_existing=True,
            )
            logger.info("Ingestion produced %d chunks for file %s", num, file_id)
        except Exception:
            logger.exception("Ingestion pipeline failed for file %s", file_id)
            if stored_chunks.chunk_count:
                await _update_file_processing_state(
                    file_id,
                    file_row,
                    user_id=user_id,
                    workspace_id=workspace_id,
                    processing_status="partially_searchable",
                    processing_error=_PARTIAL_INDEXING_ERROR,
                    metadata_updates={
                        "text_chunk_count": stored_chunks.chunk_count,
                        "text_chunks_truncated": stored_chunks.truncated,
                        "embedded_chunk_count": 0,
                        "embedded_chunk_ids": [],
                        "vector_index_status": "failed",
                    },
                    diagnostics_payload=extraction_columns_payload(diagnostics),
                )
                return {
                    "status": "failed",
                    "processing_status": "partially_searchable",
                    "error": _PARTIAL_INDEXING_ERROR,
                    "chunks": stored_chunks.chunk_ids,
                }
            raise

        await _update_file_processing_state(
            file_id,
            file_row,
            user_id=user_id,
            workspace_id=workspace_id,
            processing_status="searchable",
            metadata_updates={
                "embedded_chunk_count": num,
                "embedded_chunk_ids": chunk_ids[:20],
                "vector_index_status": "ready",
            },
        )

        # Mark job succeeded
        return {"status": "completed", "processing_status": "searchable", "chunks": chunk_ids}
    except Exception as exc:
        logger.exception("handle_ingest_file failed: %s", exc)
        if file_id and user_id is not None:
            try:
                await _update_file_processing_state(
                    file_id,
                    file_row or {"metadata": {}},
                    user_id=user_id,
                    workspace_id=workspace_id,
                    processing_status="failed",
                    processing_error=str(exc),
                )
            except Exception:
                logger.exception("Failed to mark file %s processing as failed.", file_id)
        return {"status": "failed", "error": str(exc)}
