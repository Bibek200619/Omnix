from __future__ import annotations

import io
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from ..core.security import get_current_user
from ..rag.chunking import split_text_into_chunks
from ..services.supabase_service import SupabaseServiceError, insert_many, insert_one
from ..db.supabase import get_supabase

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


async def _save_bytes_to_path(user_id: str, filename: str, data: bytes) -> str:
    user_dir = os.path.join(UPLOAD_DIR, user_id)
    os.makedirs(user_dir, exist_ok=True)
    unique_name = f"{uuid.uuid4().hex}_{filename}"
    path = os.path.join(user_dir, unique_name)
    with open(path, "wb") as fh:
        fh.write(data)
    return path


def _extract_text_from_bytes(filename: str, file_type: str | None, data: bytes) -> str:
    lowered = (file_type or "").lower()
    name_l = filename.lower()

    # PDF
    if "pdf" in lowered or name_l.endswith(".pdf"):
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            pages = []
            for page in reader.pages:
                try:
                    pages.append(page.extract_text() or "")
                except Exception:
                    # best-effort per page
                    logger.exception("Failed to extract page text from PDF page.")
            text = "\n\n".join(pages)
            return text
        except ImportError as exc:
            logger.exception("Missing pypdf dependency: %s", exc)
            raise
        except Exception as exc:
            logger.exception("PDF extraction failed: %s", exc)
            raise

    # DOCX
    if "word" in lowered or name_l.endswith(".docx"):
        try:
            import docx

            doc = docx.Document(io.BytesIO(data))
            paragraphs = [p.text for p in doc.paragraphs if p.text]
            return "\n\n".join(paragraphs)
        except ImportError as exc:
            logger.exception("Missing python-docx dependency: %s", exc)
            raise
        except Exception as exc:
            logger.exception("DOCX extraction failed: %s", exc)
            raise

    # Plain text / markdown
    try:
        text = data.decode("utf-8")
    except Exception:
        try:
            text = data.decode("latin-1")
        except Exception:
            logger.exception("Failed to decode text file")
            raise
    return text


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    conversation_id: str | None = Form(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Accept file uploads, extract text, store file metadata, and split into document chunks.

    Returns the created file metadata row.
    """
    user_id = str(current_user["sub"])

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
    filename = file.filename or "unnamed"
    if file_type not in ALLOWED_MIMES and not any(filename.lower().endswith(ext) for ext in (".pdf", ".docx", ".txt", ".md")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")

    # Save raw file to disk
    try:
        storage_path = await _save_bytes_to_path(user_id, filename, contents)
    except Exception as exc:
        logger.exception("Failed to persist uploaded file to disk: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store file")

    # Extract text (best-effort). Do not fail the upload on extraction errors.
    extracted = ""
    normalized = ""
    extraction_error: str | None = None
    try:
        extracted = _extract_text_from_bytes(filename, file_type, contents) or ""
        normalized = "\n\n".join([line.strip() for line in extracted.splitlines() if line.strip()])
    except ImportError as exc:
        logger.exception("Missing dependency for text extraction: %s", exc)
        extraction_error = f"Missing dependency: {exc}"
        normalized = ""
    except Exception as exc:
        logger.exception("Text extraction failed for file '%s': %s", filename, exc)
        extraction_error = str(exc)
        normalized = ""

    # Persist file metadata to files table
    payload = {
        "file_name": filename,
        "file_type": file_type or None,
        "size_bytes": size,
        "storage_path": storage_path,
        "metadata": {"extracted_text_preview": normalized[:2000], "extraction_error": extraction_error},
        "conversation_id": conversation_id,
    }

    try:
        file_row = await insert_one("files", {"user_id": user_id, **payload})
    except SupabaseServiceError as exc:
        logger.exception("Failed to insert file metadata: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to register file")

    # Split into chunks, generate embeddings, and insert into documents and vector store
    try:
        from ..rag.startup import get_vector_store
        from ..rag.ingestion import RAGIngestionPipeline
        
        vector_store = get_vector_store()
        pipeline = RAGIngestionPipeline(vector_store)
        await pipeline.ingest_text(normalized, user_id, document_id=file_row.get("id"))
    except Exception:
        logger.exception("Failed to run ingestion pipeline. Continuing without chunks.")

    # Return the stored file record
    return file_row
