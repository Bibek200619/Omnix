from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, List

from ..embeddings.provider import get_default_provider

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
        # If provider supports async natively, use it, else run in threadpool
        coro = provider.embed_texts(texts)
        if asyncio.iscoroutine(coro):
            return await coro
        # fallback to threadpool for sync implementations
    except Exception:
        pass

    loop = asyncio.get_running_loop()
    executor = _get_executor()
    return await loop.run_in_executor(executor, lambda: asyncio.run(provider.embed_texts(texts)))


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
