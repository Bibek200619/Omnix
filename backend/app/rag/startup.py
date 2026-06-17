from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Literal, cast

from ..core.config import get_settings
from .pgvector_store import PgVectorStore
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)

VectorBackend = Literal["pgvector", "faiss"]
SUPPORTED_VECTOR_BACKENDS = {"pgvector", "faiss"}

# Singleton instance initialized at startup
_vector_store_instance: VectorStore | None = None
_vector_store_backend: VectorBackend | None = None


def get_configured_vector_backend() -> VectorBackend:
    raw_backend = str(getattr(get_settings(), "OMNIX_VECTOR_BACKEND", "pgvector") or "pgvector")
    backend = raw_backend.strip().lower()
    if backend not in SUPPORTED_VECTOR_BACKENDS:
        raise RuntimeError(
            "Unsupported OMNIX_VECTOR_BACKEND=%r. Expected one of: %s"
            % (raw_backend, ", ".join(sorted(SUPPORTED_VECTOR_BACKENDS)))
        )
    return cast(VectorBackend, backend)


def get_vector_store() -> VectorStore:
    """
    Returns the singleton VectorStore instance.
    """
    global _vector_store_instance, _vector_store_backend
    backend = get_configured_vector_backend()
    if _vector_store_instance is None or _vector_store_backend != backend:
        _vector_store_instance = _create_vector_store(backend)
        _vector_store_backend = backend
    return _vector_store_instance


async def initialize_vector_store() -> VectorStore:
    """
    Initializes the vector store.
    """
    global _vector_store_instance, _vector_store_backend
    backend = get_configured_vector_backend()
    if _vector_store_instance is not None and _vector_store_backend == backend:
        return _vector_store_instance

    _vector_store_instance = _create_vector_store(backend)
    _vector_store_backend = backend
    return _vector_store_instance


async def shutdown_vector_store() -> None:
    """
    Gracefully shuts down the vector store on application or worker shutdown.
    """
    global _vector_store_instance, _vector_store_backend
    store = _vector_store_instance
    backend = _vector_store_backend
    if store is None:
        _vector_store_backend = None
        return

    if backend == "faiss":
        settings = get_settings()
        index_path = str(getattr(settings, "FAISS_INDEX_PATH", "./data/faiss_index.index"))
        map_path = str(getattr(settings, "FAISS_MAP_PATH", "./data/faiss_map.json"))
        try:
            Path(index_path).parent.mkdir(parents=True, exist_ok=True)
            save_local = getattr(store, "save_local")
            save_local(index_path, map_path)
            logger.info("Persisted FAISS vector store to %s and %s.", index_path, map_path)
        except Exception as exc:
            logger.exception("Failed to persist FAISS vector store on shutdown: %s", exc)

    _vector_store_instance = None
    _vector_store_backend = None


def _create_vector_store(backend: VectorBackend) -> VectorStore:
    if backend == "pgvector":
        logger.info("Using pgvector vector backend; FAISS initialization skipped.")
        return PgVectorStore()

    return _initialize_faiss_store()


def _initialize_faiss_store() -> VectorStore:
    settings = get_settings()
    index_path = str(getattr(settings, "FAISS_INDEX_PATH", "./data/faiss_index.index"))
    map_path = str(getattr(settings, "FAISS_MAP_PATH", "./data/faiss_map.json"))
    Path(index_path).parent.mkdir(parents=True, exist_ok=True)

    store = _load_faiss_store_class()()
    if os.path.exists(index_path) and os.path.exists(map_path):
        try:
            store.load_local(index_path, map_path)
            logger.info("Loaded legacy FAISS vector store from %s and %s.", index_path, map_path)
        except Exception as exc:
            logger.warning("Failed to load persisted FAISS vector store: %s. Starting empty.", exc)
    else:
        logger.info("No persisted FAISS vector store found. Starting empty legacy store.")

    return store


def _load_faiss_store_class():
    from .faiss_store import FAISSStore

    return FAISSStore
