from __future__ import annotations

import asyncio
import logging
import inspect
import threading
from typing import List

from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embeddings_dimension
from ..embeddings.provider import get_default_provider

logger = logging.getLogger(__name__)

_PROVIDER = None


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
        embed_texts = provider.embed_texts
        if inspect.iscoroutinefunction(embed_texts):
            embeddings = await embed_texts(texts)
        else:
            result = await asyncio.to_thread(embed_texts, texts)
            embeddings = await result if inspect.isawaitable(result) else result
    except Exception as exc:
        logger.exception("Embedding provider %s failed to embed %d texts.", provider.__class__.__name__, len(texts))
        raise RuntimeError(
            f"Embedding generation failed using provider {provider.__class__.__name__}: {exc}"
        ) from exc

    try:
        validate_embeddings_dimension(embeddings, expected_dim=get_expected_embedding_dimension())
    except ValueError:
        logger.exception("Embedding dimension validation failed for provider %s.", provider.__class__.__name__)
        raise

    if embeddings:
        logger.debug(
            "Generated %d embeddings with provider=%s dimension=%d.",
            len(embeddings),
            provider.__class__.__name__,
            len(embeddings[0]),
        )

    return embeddings


def get_embeddings(texts: List[str]) -> List[List[float]]:
    """Synchronous wrapper for providers (runs in-thread)."""
    if not texts:
        return []

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(get_embeddings_async(texts))

    result: dict[str, List[List[float]] | BaseException] = {}

    def _runner() -> None:
        try:
            result["value"] = asyncio.run(get_embeddings_async(texts))
        except BaseException as exc:
            result["error"] = exc

    thread = threading.Thread(target=_runner, name="embedding_sync_runner", daemon=True)
    thread.start()
    thread.join()
    if "error" in result:
        raise result["error"]  # type: ignore[misc]
    return result.get("value", [])  # type: ignore[return-value]


async def get_embedding(text: str) -> List[float]:
    res = await get_embeddings_async([text])
    return res[0] if res else []


def get_embedding_sync(text: str) -> List[float]:
    result = get_embeddings([text])
    return result[0] if result else []
