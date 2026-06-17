from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embeddings_dimension
from ..services.supabase_service import SupabaseServiceError, delete_many_trusted, insert_many, select_all_trusted
from .chunking import chunk_text
from .embedding import get_embeddings_async
from .models import DocumentChunk, IngestionResult, ParsedDocument, ParsedSection
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)
OPTIONAL_DOCUMENT_COLUMNS = ("metadata", "source_type", "updated_at", "ingestion_version")
MAX_STRIP_ITERATIONS = len(OPTIONAL_DOCUMENT_COLUMNS) + 1
DEFAULT_EMBEDDING_BATCH_SIZE = 64
MAX_INGESTION_CHUNKS = int(os.environ.get("OMNIX_MAX_INGESTION_CHUNKS", "5000"))
MAX_METADATA_ITEMS = 50
MAX_METADATA_LIST_ITEMS = 50
MAX_METADATA_STRING_CHARS = 2048
MAX_METADATA_DEPTH = 4


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RAGIngestionPipeline:
    """
    Orchestrates the ingestion of raw text into the RAG system.
    Connects the chunking, embedding, vector store modules, and database storage
    into a single pipeline.

    The pipeline is backend-agnostic: it works with any VectorStore implementation
    (FAISS, pgvector, etc.).
    """

    def __init__(self, vector_store: VectorStore) -> None:
        if not isinstance(vector_store, VectorStore):
            raise TypeError("vector_store must be an instance of VectorStore.")
        self.vector_store = vector_store

    async def ingest_text(
        self,
        text: str,
        user_id: str,
        document_id: str | None = None,
        workspace_id: str | None = None,
        *,
        metadata: dict[str, Any] | None = None,
        source_type: str = "text",
        replace_existing: bool = True,
    ) -> tuple[int, list[str]]:
        """
        Processes raw text through the chunking and embedding pipeline, saving
        chunk rows and embeddings to Supabase/pgvector-compatible storage.

        Args:
            text (str): The raw text string to ingest.
            user_id (str): The ID of the user who owns this text. Required for multi-tenant isolation.
            document_id (str | None): An optional document ID to link these chunks to a specific file.
            workspace_id (str | None): Optional workspace that these chunks belong to.

        Returns:
            tuple[int, list[str]]: (number of chunks, list of chunk ids)
        """
        parsed = ParsedDocument(
            text=text,
            metadata=dict(metadata or {}),
            sections=[ParsedSection(text=text, metadata={})] if text and text.strip() else [],
            source_type=source_type,
        )
        result = await self.ingest_parsed_document(
            parsed,
            user_id=user_id,
            document_id=document_id,
            workspace_id=workspace_id,
            replace_existing=replace_existing,
        )
        return result.chunk_count, result.chunk_ids

    async def ingest_parsed_document(
        self,
        parsed_document: ParsedDocument,
        *,
        user_id: str,
        document_id: str | None = None,
        workspace_id: str | None = None,
        replace_existing: bool = True,
    ) -> IngestionResult:
        """Ingest parsed document sections while preserving source metadata."""
        text = parsed_document.text
        if not text or not text.strip():
            logger.warning("Empty text provided to ingestion pipeline. Skipping.")
            return IngestionResult(chunk_count=0, chunk_ids=[], skipped=True)
        if not user_id:
            raise ValueError("user_id is required for ingestion to maintain tenant isolation.")

        logger.info("Starting ingestion pipeline for new text.")

        chunks = self._chunks_from_parsed_document(parsed_document)
        if not chunks:
            logger.warning("Text chunking resulted in 0 chunks. Skipping.")
            return IngestionResult(chunk_count=0, chunk_ids=[], skipped=True)
        if len(chunks) > MAX_INGESTION_CHUNKS:
            raise RuntimeError(
                f"Document produced {len(chunks)} chunks, exceeding the ingestion limit of {MAX_INGESTION_CHUNKS}."
            )

        num_chunks = len(chunks)
        logger.info("Text split into %d chunks.", num_chunks)

        chunk_ids: list[str] = []
        db_payloads: list[dict[str, Any]] = []
        timestamp = _utc_now_iso()
        ingestion_version = timestamp

        for i, chunk in enumerate(chunks):
            chunk_id = str(uuid.uuid4())
            chunk_ids.append(chunk_id)
            payload = {
                "id": chunk_id,
                "user_id": user_id,
                "content": chunk.content,
                "chunk_index": i,
                "created_at": timestamp,
                "updated_at": timestamp,
                "ingestion_version": ingestion_version,
                "metadata": chunk.metadata,
                "source_type": parsed_document.source_type,
            }
            if document_id:
                payload["file_id"] = document_id
            if workspace_id:
                payload["workspace_id"] = workspace_id
            db_payloads.append(payload)

        try:
            logger.info("Generating embeddings for %d chunks...", num_chunks)
            embeddings = await self._embed_chunks(chunks)
        except Exception as exc:
            logger.exception("Failed to generate embeddings during ingestion.")
            raise RuntimeError("Ingestion pipeline failed at the embedding stage.") from exc

        if len(embeddings) != num_chunks:
            logger.error(
                "Mismatch in pipeline: %d chunks produced %d embeddings.",
                num_chunks,
                len(embeddings),
            )
            raise RuntimeError("Pipeline inconsistency: chunk count does not match embedding count.")

        try:
            expected_dim = get_expected_embedding_dimension()
            validate_embeddings_dimension(embeddings, expected_dim=expected_dim, label="ingestion embeddings")
            logger.info("Embeddings generated with dimension %d for %d chunks.", expected_dim, len(embeddings))
        except ValueError as exc:
            logger.error("Embedding dimension validation failed during ingestion: %s", exc)
            raise RuntimeError("Ingestion pipeline failed because embedding dimensions do not match the DB contract.") from exc

        try:
            logger.info("Attaching embeddings to payloads and inserting %d chunks into Supabase.", num_chunks)
            for i, emb in enumerate(embeddings):
                db_payloads[i]["embedding"] = emb

            old_chunk_ids = await self._existing_chunk_ids(document_id) if replace_existing else []

            if old_chunk_ids:
                await delete_many_trusted("documents", {"id": old_chunk_ids})
            try:
                await self._insert_document_payloads(db_payloads)
            except Exception:
                if old_chunk_ids:
                    logger.critical(
                        "Document re-ingestion insert failed after deleting old chunks; manual recovery required. "
                        "document_id=%s old_chunk_count=%d",
                        document_id,
                        len(old_chunk_ids),
                    )
                raise
        except Exception as exc:
            logger.exception("Failed to save chunks to Supabase.")
            raise RuntimeError("Ingestion pipeline failed at the database stage.") from exc

        logger.info("Successfully ingested %d chunks.", num_chunks)
        return IngestionResult(chunk_count=num_chunks, chunk_ids=chunk_ids)

    @staticmethod
    def _chunks_from_parsed_document(parsed_document: ParsedDocument) -> list[DocumentChunk]:
        sections = parsed_document.sections or [ParsedSection(text=parsed_document.text, metadata={})]
        chunks: list[DocumentChunk] = []

        for section_index, section in enumerate(sections):
            section_metadata = {
                **_sanitize_metadata(dict(parsed_document.metadata or {})),
                **_sanitize_metadata(dict(section.metadata or {})),
                "section_index": section_index,
            }
            for raw_chunk in chunk_text(section.text, metadata=section_metadata):
                chunks.append(
                    DocumentChunk(
                        content=str(raw_chunk["content"]),
                        chunk_index=len(chunks),
                        token_count=int(raw_chunk.get("token_count") or 0),
                        metadata={
                            **dict(raw_chunk.get("metadata") or {}),
                            "chunk_index": len(chunks),
                        },
                    )
                )

        return chunks

    @staticmethod
    async def _embed_chunks(chunks: list[DocumentChunk]) -> list[list[float]]:
        embeddings: list[list[float]] = []
        for start in range(0, len(chunks), DEFAULT_EMBEDDING_BATCH_SIZE):
            batch = chunks[start : start + DEFAULT_EMBEDDING_BATCH_SIZE]
            embeddings.extend(await get_embeddings_async([chunk.content for chunk in batch]))
        return embeddings

    @staticmethod
    async def _insert_document_payloads(payloads: list[dict[str, Any]]) -> None:
        stripped_columns: set[str] = set()
        original_error: SupabaseServiceError | None = None
        last_error: SupabaseServiceError | None = None

        for _ in range(MAX_STRIP_ITERATIONS):
            candidate_payloads = [
                {
                    key: value
                    for key, value in payload.items()
                    if key not in stripped_columns
                }
                for payload in payloads
            ]
            try:
                await insert_many("documents", candidate_payloads)
                return
            except SupabaseServiceError as exc:
                if original_error is None:
                    original_error = exc
                last_error = exc
                message = str(exc.__cause__ or exc).lower()
                missing_optional_columns = [
                    column
                    for column in OPTIONAL_DOCUMENT_COLUMNS
                    if column not in stripped_columns
                    and column in message
                    and ("does not exist" in message or "schema cache" in message or "could not find" in message)
                ]
                if not missing_optional_columns:
                    break

                stripped_columns.update(missing_optional_columns)
                logger.warning(
                    "Retrying document insert without optional columns unavailable in this Supabase schema: %s.",
                    ", ".join(sorted(stripped_columns)),
                )

        stripped = ", ".join(sorted(stripped_columns)) or "none"
        original = str(original_error.__cause__ or original_error or last_error or "unknown")
        raise RuntimeError(
            "Document insert failed after optional column stripping; "
            f"stripped columns: {stripped}; original error: {original}"
        ) from last_error

    @staticmethod
    async def _existing_chunk_ids(document_id: str | None) -> list[str]:
        if not document_id:
            return []

        rows = await select_all_trusted(
            "documents",
            "id",
            filters={"file_id": document_id},
        )
        return [str(row["id"]) for row in rows if row.get("id")]


def _sanitize_metadata(value: Any, *, depth: int = 0) -> Any:
    if depth > MAX_METADATA_DEPTH:
        return str(value)[:MAX_METADATA_STRING_CHARS]

    if value is None or isinstance(value, (bool, int, float)):
        return value

    if isinstance(value, str):
        return value[:MAX_METADATA_STRING_CHARS]

    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= MAX_METADATA_ITEMS:
                sanitized["_truncated"] = True
                break
            key_text = str(key)[:128]
            sanitized[key_text] = _sanitize_metadata(item, depth=depth + 1)
        return sanitized

    if isinstance(value, (list, tuple, set)):
        items = list(value)
        sanitized_items = [
            _sanitize_metadata(item, depth=depth + 1)
            for item in items[:MAX_METADATA_LIST_ITEMS]
        ]
        if len(items) > MAX_METADATA_LIST_ITEMS:
            sanitized_items.append({"_truncated": True})
        return sanitized_items

    return str(value)[:MAX_METADATA_STRING_CHARS]
