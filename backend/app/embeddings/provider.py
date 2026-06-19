from __future__ import annotations

from abc import ABC, abstractmethod
import logging
import os
from typing import List

logger = logging.getLogger(__name__)


class EmbeddingProvider(ABC):
    """Abstract interface for embedding providers."""

    @abstractmethod
    async def embed_text(self, text: str) -> List[float]:
        raise NotImplementedError

    @abstractmethod
    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        raise NotImplementedError

    async def warmup(self) -> None:
        """Optional provider startup hook."""
        return None


def _normalize_provider_name(provider_name: str | None) -> str:
    return (provider_name or os.environ.get("EMBEDDING_PROVIDER", "local")).strip().lower()


def get_provider(provider_name: str | None = None) -> EmbeddingProvider:
    """Create an embedding provider.

    Local sentence-transformers embeddings are the default. OpenAI remains
    available only when explicitly selected with EMBEDDING_PROVIDER=openai.
    """
    provider = _normalize_provider_name(provider_name)

    if provider in ("local", "sentence-transformers", "sbert"):
        from .local_provider import LocalEmbeddingProvider

        logger.info("Selected embedding provider: local (%s).", LocalEmbeddingProvider.__name__)
        return LocalEmbeddingProvider()

    if provider == "openai":
        from .openai_provider import OpenAIEmbeddingProvider

        logger.info("Selected embedding provider: openai.")
        return OpenAIEmbeddingProvider()

    raise ValueError(
        f"Unknown EMBEDDING_PROVIDER={provider!r}. "
        "Supported providers: local, sentence-transformers, sbert, openai."
    )


def get_default_provider() -> EmbeddingProvider:
    return get_provider()


async def warm_up_default_provider() -> EmbeddingProvider:
    provider = get_default_provider()
    await provider.warmup()
    logger.info("Embedding provider warmup completed: %s.", provider.__class__.__name__)
    return provider
