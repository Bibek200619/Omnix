from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from ..services.supabase_service import insert_many
from .chunking import split_text_into_chunks
from .embedding import get_embeddings_async
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)


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
        """
        Initializes the ingestion pipeline.

        Args:
            vector_store (VectorStore): An active instance of any VectorStore implementation.
                                       This instance is reused across multiple ingestions.
        """
        if not isinstance(vector_store, VectorStore):
            raise TypeError("vector_store must be an instance of VectorStore.")
        self.vector_store = vector_store

    async def ingest_text(self, text: str, user_id: str, document_id: str | None = None) -> tuple[int, list[str]]:
        """
        Processes raw text through the chunking and embedding pipeline, saving the 
        resulting vectors to the FAISS store and the text to Supabase.

        Args:
            text (str): The raw text string to ingest.
            user_id (str): The ID of the user who owns this text. Required for multi-tenant isolation.
            document_id (str | None): An optional document ID to link these chunks to a specific file.

        Returns:
            tuple[int, list[str]]: A tuple containing the number of chunks processed 
                                   and a list of the exact string IDs assigned to those chunks.
        """
        if not text or not text.strip():
            logger.warning("Empty text provided to ingestion pipeline. Skipping.")
            return 0, []
        if not user_id:
            raise ValueError("user_id is required for ingestion to maintain tenant isolation.")

        logger.info("Starting ingestion pipeline for new text.")

        # 1. Chunking
        chunks = split_text_into_chunks(text)
        if not chunks:
            logger.warning("Text chunking resulted in 0 chunks. Skipping.")
            return 0, []

        num_chunks = len(chunks)
        logger.info("Text split into %d chunks.", num_chunks)

        # 2. Generate IDs and DB Payloads
        chunk_ids: list[str] = []
        db_payloads: list[dict[str, Any]] = []
        timestamp = _utc_now_iso()
        
        for i, chunk_text in enumerate(chunks):
            chunk_id = str(uuid.uuid4())
            chunk_ids.append(chunk_id)
            payload = {
                "id": chunk_id,
                "user_id": user_id,
                "content": chunk_text,
                "created_at": timestamp
            }
            if document_id:
                payload["file_id"] = document_id
            db_payloads.append(payload)

        # 3. Generate Embeddings (Batch) - using async wrapper to prevent event loop blocking
        try:
            logger.info("Generating embeddings for %d chunks...", num_chunks)
            embeddings = await get_embeddings_async(chunks)
        except Exception as exc:
            logger.exception("Failed to generate embeddings during ingestion.")
            raise RuntimeError("Ingestion pipeline failed at the embedding stage.") from exc

        # Safety check to ensure consistency before writing to the vector store
        if len(embeddings) != num_chunks:
            logger.error(
                "Mismatch in pipeline: %d chunks produced %d embeddings.", 
                num_chunks, len(embeddings)
            )
            raise RuntimeError("Pipeline inconsistency: chunk count does not match embedding count.")

        # 4. Save to Database
        try:
            logger.info("Inserting %d chunks into Supabase.", num_chunks)
            await insert_many("documents", db_payloads)
        except Exception as exc:
            logger.exception("Failed to save chunks to Supabase.")
            raise RuntimeError("Ingestion pipeline failed at the database stage.") from exc

        # 5. Save to Vector Store
        try:
            logger.info("Adding %d vectors to the FAISS store.", num_chunks)
            user_ids = [user_id] * num_chunks
            self.vector_store.add_embeddings(embeddings, chunk_ids, user_ids)
        except Exception as exc:
            logger.exception("Failed to add vectors to the FAISS store during ingestion.")
            raise RuntimeError("Ingestion pipeline failed at the vector store stage.") from exc

        logger.info("Successfully ingested %d chunks.", num_chunks)
        return num_chunks, chunk_ids
