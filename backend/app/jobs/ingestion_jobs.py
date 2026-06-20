from __future__ import annotations

import logging
from typing import Any
from datetime import datetime, timezone

from ..services.file_storage import resolve_managed_storage_path
from ..services.supabase_service import (
    select_one_trusted,
    update_one_trusted,
)
from ..services.document_intelligence_service import (
    diagnostics_from_file,
    extract_document_with_diagnostics,
    extraction_columns_payload,
)
from ..rag.startup import get_vector_store
from ..rag.ingestion import RAGIngestionPipeline

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def handle_ingest_file(job_row: dict[str, Any]) -> dict[str, Any]:
    """Process an ingestion job created after file upload. Expects payload in job_row['payload']."""
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
            "extraction_status,extraction_failure_reason,ocr_used,ocr_character_count,created_at"
        )
        file_row = await select_one_trusted("files", FILE_COLUMNS, {"id": file_id})
        if file_row is None:
            raise RuntimeError("File not found for ingestion")

        storage_path = resolve_managed_storage_path(file_row.get("storage_path"))
        filename = file_row.get("file_name") or "imported"
        file_type = file_row.get("file_type")

        if storage_path is None or not storage_path.exists():
            raise RuntimeError("Stored file not found on disk")

        # Read bytes
        with storage_path.open("rb") as fh:
            data = fh.read()

        extraction_result = extract_document_with_diagnostics(filename, file_type, data)
        normalized = extraction_result.text
        diagnostics = extraction_result.diagnostics
        metadata = dict(file_row.get("metadata") or {})
        metadata.update({"extracted_text_preview": normalized[:2000], **diagnostics.to_metadata()})
        if diagnostics.extraction_failure_reason:
            metadata["extraction_error"] = diagnostics.extraction_failure_reason
        try:
            file_row = await update_one_trusted(
                "files",
                {"id": file_id},
                {"metadata": metadata, **extraction_columns_payload(diagnostics)},
            ) or file_row
        except Exception:
            logger.warning("Unable to persist physical extraction diagnostics in ingestion worker; retrying metadata only.")
            await update_one_trusted("files", {"id": file_id}, {"metadata": metadata})
            file_row["metadata"] = metadata

        diagnostics = diagnostics_from_file(file_row)
        if diagnostics.extraction_status != "searchable" or not normalized:
            return {
                "status": "failed" if diagnostics.extraction_status == "extraction_failed" else "completed",
                "file_status": diagnostics.extraction_status,
                "error": diagnostics.extraction_failure_reason,
                "chunks": [],
            }

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
            raise

        # Mark job succeeded
        return {"status": "completed", "chunks": chunk_ids}
    except Exception as exc:
        logger.exception("handle_ingest_file failed: %s", exc)
        return {"status": "failed", "error": str(exc)}
