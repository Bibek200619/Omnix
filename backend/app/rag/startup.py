from __future__ import annotations

import logging
import os
from pathlib import Path

from ..core.config import get_settings
from .pgvector_store import PgVectorStore
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)

# Singleton instance initialized at startup
_vector_store_instance: VectorStore | None = None


def get_vector_store() -> VectorStore:
    """
    Returns the singleton VectorStore instance.
    Must call initialize_vector_store() during app startup first.
    
    Returns:
        VectorStore: The initialized vector store instance (any implementation).
    
    Raises:
        RuntimeError: If called before initialize_vector_store() is called.
    """
    global _vector_store_instance
    if _vector_store_instance is None:
        raise RuntimeError("Vector store not initialized. Call initialize_vector_store() on startup.")
    return _vector_store_instance


async def initialize_vector_store() -> VectorStore:
    """
    Initializes the vector store on application startup.
    Currently uses FAISS, but can be swapped for pgvector or other implementations.
    Loads from persisted files if they exist, otherwise initializes empty.
    
    Returns:
        VectorStore: The initialized vector store instance.
    """
    global _vector_store_instance
    
    logger.info("Initializing vector store...")
    
    settings = get_settings()
    index_path = settings.FAISS_INDEX_PATH
    map_path = settings.FAISS_MAP_PATH
    
    # Create data directory if it doesn't exist
    data_dir = Path(index_path).parent
    data_dir.mkdir(parents=True, exist_ok=True)
    logger.debug("Ensured data directory exists: %s", data_dir)
    
    # Initialize new FAISS store
    store: VectorStore = PgVectorStore()
    logger.debug("Created new FAISSStore instance.")
    
    # Try to load from disk if files exist
    if os.path.exists(index_path) and os.path.exists(map_path):
        try:
            logger.info("Found persisted vector index. Loading from %s and %s", index_path, map_path)
            store.load_local(index_path, map_path)
            logger.info("Successfully loaded vector index.")
        except Exception as exc:
            logger.warning("Failed to load persisted vector index: %s. Starting with empty store.", exc)
    else:
        logger.info("No persisted vector index found. Starting with empty store.")
    
    _vector_store_instance = store
    return store


async def shutdown_vector_store() -> None:
    """
    Gracefully shuts down the vector store on application shutdown.
    Persists the current state to disk.
    """
    global _vector_store_instance
    
    if _vector_store_instance is None:
        logger.debug("Vector store not initialized, skipping shutdown.")
        return
    
    settings = get_settings()
    index_path = settings.FAISS_INDEX_PATH
    map_path = settings.FAISS_MAP_PATH
    
    try:
        logger.info("Persisting FAISS index to %s and %s", index_path, map_path)
        _vector_store_instance.save_local(index_path, map_path)
        logger.info("Successfully persisted FAISS index with %d vectors.", _vector_store_instance.index.ntotal)
    except Exception as exc:
        logger.exception("Failed to persist FAISS index on shutdown: %s", exc)
    
    _vector_store_instance = None
