from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List


class EmbeddingProvider(ABC):
    """Abstract interface for embedding providers."""

    @abstractmethod
    async def embed_text(self, text: str) -> List[float]:
        raise NotImplementedError

    @abstractmethod
    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        raise NotImplementedError


def get_default_provider() -> EmbeddingProvider:
    """Factory to return default provider based on env var EMBEDDING_PROVIDER."""
    import os

    provider = os.environ.get("EMBEDDING_PROVIDER", "openai").lower()
    if provider == "openai":
        from .openai_provider import OpenAIEmbeddingProvider

        return OpenAIEmbeddingProvider()
    else:
        # Fallback to openai for now
        from .openai_provider import OpenAIEmbeddingProvider

        return OpenAIEmbeddingProvider()
