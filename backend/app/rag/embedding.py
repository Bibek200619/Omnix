from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, List

from ..embeddings.provider import get_default_provider
from ..embeddings.local_provider import LocalEmbeddingProvider  # for typing/validation

logger = logging.getLogger(__name__)

# Keep a singleton provider to avoid recreating HTTP clients
_PROVIDER = None
_EMBEDDING_EXECUTOR: ThreadPoolExecutor | None = None


def _get_executor() -> ThreadPoolExecutor:
    global _EMBEDDING_EXECUTOR
    if _EMBEDDING_EXECUTOR is None:
        _EMBEDDING_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="embedding_worker")
    return _EMBEDDING_EXECUTOR


def _get_provider():
    global _PROVIDER
    if _PROVIDER is None:
        _PROVIDER = get_default_provider()
    return _PROVIDER


async def get_embeddings_async(texts: List[str]) -> List[List[float]]:
    """Async batch embeddings using selected provider."""
    if not texts:
        return []
    provider = _get_provider()
    try:
        coro_or_result = provider.embed_texts(texts)
        if asyncio.iscoroutine(coro_or_result):
            embeddings = await coro_or_result
        else:
            # provider implemented a synchronous embed_texts; run in thread
            embeddings = await asyncio.to_thread(provider.embed_texts, texts)
    except Exception:
        # last-resort: run blocking call in executor to avoid crashing loop
        loop = asyncio.get_running_loop()
        executor = _get_executor()
        embeddings = await loop.run_in_executor(executor, lambda: asyncio.run(provider.embed_texts(texts)))

    # Validate embedding dimensionality if provider exposes it
    try:
        expected_dim = getattr(provider, "embedding_dim", None)
        if expected_dim is not None and embeddings:
            if any(len(e) != expected_dim for e in embeddings):
                logger.warning(
                    "Embedding dimension mismatch: expected %s but got %s. Adjusting provider.embedding_dim to actual.",
                    expected_dim,
                    len(embeddings[0]) if embeddings and embeddings[0] else None,
                )
                # update provider metadata to reflect actual dim
                try:
                    provider.embedding_dim = len(embeddings[0]) if embeddings and embeddings[0] else expected_dim
                except Exception:
                    pass
    except Exception:
        pass

    return embeddings


def get_embeddings(texts: List[str]) -> List[List[float]]:
    """Synchronous wrapper for providers (runs in-thread)."""
    if not texts:
        return []
    provider = _get_provider()
    try:
        # Prefer sync if provider offers sync method
        res = asyncio.get_event_loop().run_until_complete(provider.embed_texts(texts))
        return res
    except Exception:
        # Run in a separate thread to avoid blocking
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(provider.embed_texts(texts))
        finally:
            loop.close()


async def get_embedding(text: str) -> List[float]:
    res = await get_embeddings_async([text])
    return res[0] if res else []


def get_embedding_sync(text: str) -> List[float]:
    return asyncio.get_event_loop().run_until_complete(get_embedding(text))
