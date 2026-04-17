from __future__ import annotations

import logging
import os
from typing import Any
from datetime import datetime, timezone

from ..services.supabase_service import (
    select_one_trusted,
    update_one_trusted,
)
from ..routers.upload import _extract_text_from_bytes
from ..rag.startup import get_vector_store
from ..rag.ingestion import RAGIngestionPipeline
from ..rag.ingestion_service import DocumentIngestionService

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
        FILE_COLUMNS = "id,user_id,workspace_id,file_name,file_type,size_bytes,storage_path,metadata,created_at"
        file_row = await select_one_trusted("files", FILE_COLUMNS, {"id": file_id})
        if file_row is None:
            raise RuntimeError("File not found for ingestion")

        storage_path = file_row.get("storage_path")
        filename = file_row.get("file_name") or "imported"
        file_type = file_row.get("file_type")

        if not storage_path or not os.path.exists(storage_path):
            raise RuntimeError("Stored file not found on disk")

        # Read bytes
        with open(storage_path, "rb") as fh:
            data = fh.read()

        # Extract text
        try:
            text = _extract_text_from_bytes(filename, file_type, data)
            normalized = "\n\n".join([line.strip() for line in text.splitlines() if line.strip()])
        except Exception:
            logger.exception("Text extraction failed; using raw decode fallback")
            try:
                normalized = data.decode("utf-8", errors="ignore")
            except Exception:
                normalized = ""

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
            if "word" in (file_type or "").lower() or str(filename).lower().endswith(".docx"):
                num, chunk_ids = await pipeline.ingest_text(
                    normalized,
                    user_id,
                    document_id=file_id,
                    workspace_id=workspace_id,
                    metadata={"filename": filename, "content_type": file_type},
                    source_type="docx",
                    replace_existing=True,
                )
            else:
                ingestion_service = DocumentIngestionService(pipeline)
                result = await ingestion_service.ingest_bytes(
                    data,
                    user_id=user_id,
                    file_id=file_id,
                    workspace_id=workspace_id,
                    filename=filename,
                    content_type=file_type,
                    metadata={"file_id": file_id},
                    replace_existing=True,
                )
                num, chunk_ids = result.chunk_count, result.chunk_ids
            logger.info("Ingestion produced %d chunks for file %s", num, file_id)
        except Exception:
            logger.exception("Ingestion pipeline failed for file %s", file_id)
            raise

        # Mark job succeeded
        return {"status": "completed", "chunks": chunk_ids}
    except Exception as exc:
        logger.exception("handle_ingest_file failed: %s", exc)
        return {"status": "failed", "error": str(exc)}
