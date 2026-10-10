from __future__ import annotations

import os
import logging
import asyncio
import httpx
from typing import List

from .dimensions import get_expected_embedding_dimension, validate_embeddings_dimension
from .provider import EmbeddingProvider
from .utils import batch_list

logger = logging.getLogger(__name__)


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self, api_key: str | None = None, model: str | None = None, batch_size: int | None = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY not set. OpenAI embeddings are only used when EMBEDDING_PROVIDER=openai.")
        self.model = model or os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        self.embedding_dim = int(os.environ.get("OPENAI_EMBEDDING_DIMENSIONS") or get_expected_embedding_dimension())
        self.batch_size = int(batch_size or int(os.environ.get("OPENAI_EMBED_BATCH_SIZE", "16")))
        self.base_url = os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def _call_embed(self, inputs: List[str]) -> List[List[float]]:
        url = f"{self.base_url}/embeddings"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {"model": self.model, "input": inputs}
        if self.embedding_dim:
            payload["dimensions"] = self.embedding_dim

        backoff = 1.0
        for attempt in range(4):
            try:
                resp = await self._client.post(url, json=payload, headers=headers)
                if resp.status_code == 429:
                    # rate limit
                    logger.warning("OpenAI rate limited, sleeping %s seconds", backoff)
                    await asyncio.sleep(backoff)
                    backoff *= 2
                    continue
                resp.raise_for_status()
                data = resp.json()
                embeddings = [item["embedding"] for item in data.get("data", [])]
                validate_embeddings_dimension(embeddings, expected_dim=self.embedding_dim, label="OpenAI embeddings")
                return embeddings
            except httpx.RequestError:
                logger.error("Request error calling OpenAI embeddings.")
                await asyncio.sleep(backoff)
                backoff *= 2
            except httpx.HTTPStatusError as exc:
                logger.error(
                    "HTTP error from OpenAI embeddings: status=%s",
                    exc.response.status_code,
                )
                # If client error, do not retry
                if (
                    400 <= exc.response.status_code < 500
                    and exc.response.status_code != 429
                ):
                    raise RuntimeError("OpenAI embedding request failed.") from None
                await asyncio.sleep(backoff)
                backoff *= 2
        raise RuntimeError("Failed to call OpenAI embeddings after retries")

    async def embed_text(self, text: str) -> List[float]:
        if not text or not text.strip():
            return []
        result = await self.embed_texts([text])
        return result[0] if result else []

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        batches = batch_list(texts, self.batch_size)
        results: List[List[float]] = []
        for batch in batches:
            emb = await self._call_embed(batch)
            results.extend(emb)
        return results

    async def close(self):
        try:
            await self._client.aclose()
        except Exception:
            pass
