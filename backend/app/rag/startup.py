from __future__ import annotations

import logging

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
    Initializes the vector store on application or worker startup.
    PgVectorStore is the default persisted vector backend.
    
    Returns:
        VectorStore: The initialized vector store instance.
    """
    global _vector_store_instance
    
    logger.info("Initializing vector store...")
    
    # Initialize pgvector-backed store. This does not depend on FastAPI state and
    # is safe to call from workers.
    store: VectorStore = PgVectorStore()
    logger.info("Created PgVectorStore instance.")

    _vector_store_instance = store
    return store


async def shutdown_vector_store() -> None:
    """
    Gracefully shuts down the vector store on application or worker shutdown.
    """
    global _vector_store_instance
    
    if _vector_store_instance is None:
        logger.debug("Vector store not initialized, skipping shutdown.")
        return
    
    try:
        _vector_store_instance.save_local("", "")
        logger.info("Vector store shutdown hook completed for %s.", _vector_store_instance.__class__.__name__)
    except Exception as exc:
        logger.exception("Failed to run vector store shutdown hook: %s", exc)
    
    _vector_store_instance = None
