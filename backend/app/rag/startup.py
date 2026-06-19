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
    """
    global _vector_store_instance
    if _vector_store_instance is None:
        _vector_store_instance = PgVectorStore()
    return _vector_store_instance


async def initialize_vector_store() -> VectorStore:
    """
    Initializes the vector store.
    """
    return get_vector_store()


async def shutdown_vector_store() -> None:
    """
    Gracefully shuts down the vector store on application or worker shutdown.
    """
    global _vector_store_instance
    _vector_store_instance = None
