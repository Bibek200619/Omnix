# Code Changes - Detailed Summary

## File 1: `app/core/config.py` - Added Config Settings

```python
# BEFORE:
class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWKS_URL: str | None = None
    MODEL_URL: str = "http://localhost:8000/v1/chat/completions"

# AFTER:
class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWKS_URL: str | None = None
    MODEL_URL: str = "http://localhost:8000/v1/chat/completions"
    SIMILARITY_THRESHOLD: float = 1.5  # NEW
    FAISS_INDEX_PATH: str = "./data/faiss_index.index"  # NEW
    FAISS_MAP_PATH: str = "./data/faiss_map.json"  # NEW
```

---

## File 2: `app/rag/embedding.py` - Added Async Wrapper

```python
# ADDITIONS:
def _get_executor() -> ThreadPoolExecutor:
    """Returns singleton ThreadPoolExecutor for embedding operations."""
    global _EMBEDDING_EXECUTOR
    if _EMBEDDING_EXECUTOR is None:
        _EMBEDDING_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="embedding_worker")
    return _EMBEDDING_EXECUTOR

async def get_embeddings_async(texts: list[str]) -> list[list[float]]:
    """Async wrapper that runs embedding in threadpool to prevent blocking."""
    if not texts:
        return []
    try:
        loop = asyncio.get_running_loop()
        executor = _get_executor()
        return await loop.run_in_executor(executor, get_embeddings, texts)
    except Exception as exc:
        logger.exception("Failed to generate async embeddings.")
        raise RuntimeError("Async batch embedding generation failed.") from exc
```

---

## File 3: `app/rag/ingestion.py` - Use Async Embedding

```python
# BEFORE:
embeddings = get_embeddings(chunks)

# AFTER:
embeddings = await get_embeddings_async(chunks)

# Also added import:
from .embedding import get_embeddings_async
```

---

## File 4: `app/rag/retrieval.py` - Config Threshold + Logging

```python
# ADDED IMPORT:
from ..core.config import get_settings

# BEFORE METHOD SIGNATURE:
async def retrieve(self, query: str, user_id: str, top_k: int = 5, 
                   distance_threshold: float = 1.5) -> list[str]:

# AFTER METHOD SIGNATURE:
async def retrieve(self, query: str, user_id: str, top_k: int = 5, 
                   distance_threshold: float | None = None) -> list[str]:
    """
    ... updated docstring ...
    distance_threshold (float | None): If None, uses SIMILARITY_THRESHOLD from config.
    """

# NEW LOGIC IN METHOD:
if distance_threshold is None:
    distance_threshold = get_settings().SIMILARITY_THRESHOLD

# ENHANCED LOGGING:
chunk_ids: list[str] = []
filtered_count = 0
for chunk_id, distance in search_results:
    if distance <= distance_threshold:
        chunk_ids.append(chunk_id)
    else:
        filtered_count += 1
        logger.debug("Chunk '%s' rejected: %.4f > %.4f", 
                     chunk_id, distance, distance_threshold)

if filtered_count > 0:
    logger.info("Filtered threshold: %d found, %d passed (%.1f%%)", 
                len(search_results), len(chunk_ids), 
                (len(chunk_ids) / len(search_results) * 100) if search_results else 0)
```

---

## File 5: `app/main.py` - Added Startup/Shutdown

```python
# NEW IMPORTS:
from .rag.startup import initialize_vector_store, shutdown_vector_store

# NEW EVENT HANDLERS:
@app.on_event("startup")
async def startup_event():
    """Initialize FAISS vector store on application startup."""
    logger.info("Starting Omnix Backend API...")
    try:
        await initialize_vector_store()
        logger.info("Vector store initialized successfully.")
    except Exception as exc:
        logger.exception("Failed to initialize vector store on startup.")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Persist FAISS vector store on application shutdown."""
    logger.info("Shutting down Omnix Backend API...")
    try:
        await shutdown_vector_store()
        logger.info("Vector store persisted successfully.")
    except Exception as exc:
        logger.exception("Failed to persist vector store on shutdown.")
```

---

## File 6: `app/rag/startup.py` - NEW FILE (92 lines)

```python
"""
Application lifecycle management for FAISS vector store.
Handles initialization on startup and persistence on shutdown.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from ..core.config import get_settings
from .vector_store import FAISSStore

logger = logging.getLogger(__name__)
_vector_store_instance: FAISSStore | None = None

def get_vector_store() -> FAISSStore:
    """Returns singleton FAISS store (must call initialize_vector_store first)."""
    global _vector_store_instance
    if _vector_store_instance is None:
        raise RuntimeError("Vector store not initialized.")
    return _vector_store_instance

async def initialize_vector_store() -> FAISSStore:
    """Initialize on startup: load from disk if exists, else start empty."""
    global _vector_store_instance
    logger.info("Initializing FAISS vector store...")
    
    settings = get_settings()
    index_path = settings.FAISS_INDEX_PATH
    map_path = settings.FAISS_MAP_PATH
    
    # Create data directory
    Path(index_path).parent.mkdir(parents=True, exist_ok=True)
    
    store = FAISSStore()
    
    # Load from disk if exists
    if os.path.exists(index_path) and os.path.exists(map_path):
        try:
            logger.info("Loading persisted FAISS index...")
            store.load_local(index_path, map_path)
            logger.info("Successfully loaded FAISS index with %d vectors.", 
                       store.index.ntotal)
        except Exception as exc:
            logger.warning("Failed to load persisted index: %s. Starting empty.", exc)
    else:
        logger.info("No persisted FAISS index found. Starting with empty store.")
    
    _vector_store_instance = store
    return store

async def shutdown_vector_store() -> None:
    """Persist on shutdown."""
    global _vector_store_instance
    
    if _vector_store_instance is None:
        logger.debug("Vector store not initialized, skipping shutdown.")
        return
    
    settings = get_settings()
    try:
        logger.info("Persisting FAISS index...")
        _vector_store_instance.save_local(settings.FAISS_INDEX_PATH, 
                                          settings.FAISS_MAP_PATH)
        logger.info("Successfully persisted FAISS index with %d vectors.", 
                   _vector_store_instance.index.ntotal)
    except Exception as exc:
        logger.exception("Failed to persist FAISS index: %s", exc)
    
    _vector_store_instance = None
```

---

## Summary of Changes

| Aspect | Lines Added | Lines Removed | Impact |
|--------|------------|---------------|--------|
| Config | 3 | 0 | Configurable threshold + persistence |
| Embedding | 35 | 0 | Async-safe, non-blocking |
| Ingestion | 1 | 1 | Uses async embedding |
| Retrieval | 40 | 5 | Config-driven threshold + metrics |
| Main | 20 | 0 | App lifecycle management |
| Startup (NEW) | 92 | - | FAISS persistence |
| **TOTAL** | **~189** | **~5** | **All 3 priorities** |

---

## Key Design Decisions

1. **Async Wrapper Pattern**: Don't break existing sync API, wrap transparently
2. **Singleton for Lifecycle**: Clean initialization/shutdown management
3. **Config-First Defaults**: All tunables are environment-driven
4. **Backward Compatible**: Existing code works without changes
5. **Minimal Code**: Focus on solving problems, not over-engineering
