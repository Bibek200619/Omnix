from __future__ import annotations

import logging
import uuid

from .chunking import split_text_into_chunks
from .embedding import get_embeddings
from .vector_store import FAISSStore

logger = logging.getLogger(__name__)


class RAGIngestionPipeline:
    """
    Orchestrates the ingestion of raw text into the RAG system.
    Connects the chunking, embedding, and vector store modules into a single pipeline.
    """

    def __init__(self, vector_store: FAISSStore) -> None:
        """
        Initializes the ingestion pipeline.

        Args:
            vector_store (FAISSStore): An active instance of the FAISS vector store. 
                                       This instance is reused across multiple ingestions.
        """
        if not isinstance(vector_store, FAISSStore):
            raise TypeError("vector_store must be an instance of FAISSStore.")
        self.vector_store = vector_store

    def ingest_text(self, text: str, base_id: str | None = None) -> tuple[int, list[str]]:
        """
        Processes raw text through the chunking and embedding pipeline, saving the 
        resulting vectors to the FAISS store.

        Args:
            text (str): The raw text string to ingest.
            base_id (str | None): An optional base ID (like a file_id or document_id). 
                                  If provided, chunk IDs will be formatted as `{base_id}_chunk_{i}`.
                                  If None, random UUIDs will be generated for each chunk.

        Returns:
            tuple[int, list[str]]: A tuple containing the number of chunks processed 
                                   and a list of the exact string IDs assigned to those chunks.
        """
        if not text or not text.strip():
            logger.warning("Empty text provided to ingestion pipeline. Skipping.")
            return 0, []

        logger.info("Starting ingestion pipeline for new text.")

        # 1. Chunking
        chunks = split_text_into_chunks(text)
        if not chunks:
            logger.warning("Text chunking resulted in 0 chunks. Skipping.")
            return 0, []

        num_chunks = len(chunks)
        logger.info("Text split into %d chunks.", num_chunks)

        # 2. Generate IDs
        chunk_ids: list[str] = []
        for i in range(num_chunks):
            if base_id:
                chunk_ids.append(f"{base_id}_chunk_{i}")
            else:
                chunk_ids.append(str(uuid.uuid4()))

        # 3. Generate Embeddings (Batch)
        try:
            logger.info("Generating embeddings for %d chunks...", num_chunks)
            embeddings = get_embeddings(chunks)
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

        # 4. Save to Vector Store
        try:
            logger.info("Adding %d vectors to the FAISS store.", num_chunks)
            self.vector_store.add_embeddings(embeddings, chunk_ids)
        except Exception as exc:
            logger.exception("Failed to add vectors to the FAISS store during ingestion.")
            raise RuntimeError("Ingestion pipeline failed at the vector store stage.") from exc

        logger.info("Successfully ingested %d chunks.", num_chunks)
        return num_chunks, chunk_ids
