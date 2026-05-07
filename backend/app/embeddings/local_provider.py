from __future__ import annotations

import os
import asyncio
import logging
from typing import List

from .provider import EmbeddingProvider

logger = logging.getLogger(__name__)


class LocalEmbeddingProvider(EmbeddingProvider):
    """Local embedding provider using sentence-transformers.

    Loads the model lazily in a thread to avoid blocking the event loop.
    Exposes embedding_dim attribute after first encode.
    """

    _MODEL = None

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or os.environ.get("LOCAL_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
        self.embedding_dim: int | None = None
        self._loaded = False

    def _load_model_sync(self):
        # synchronous model load; executed in a thread
        from sentence_transformers import SentenceTransformer

        logger.info("Loading local sentence-transformers model '%s'", self.model_name)
        model = SentenceTransformer(self.model_name)
        return model

    async def _ensure_loaded(self):
        if LocalEmbeddingProvider._MODEL is None:
            logger.debug("LocalEmbeddingProvider: model not loaded, loading in thread...")
            try:
                model = await asyncio.to_thread(self._load_model_sync)
                LocalEmbeddingProvider._MODEL = model
                # detect dimension
                try:
                    dim = model.get_sentence_embedding_dimension()
                    self.embedding_dim = int(dim)
                except Exception:
                    self.embedding_dim = None
                logger.info("Local model loaded: %s (dim=%s)", self.model_name, self.embedding_dim)
            except Exception as exc:
                logger.exception("Failed to load local embedding model: %s", exc)
                raise
        else:
            logger.debug("LocalEmbeddingProvider: model already loaded")
            if self.embedding_dim is None:
                try:
                    self.embedding_dim = LocalEmbeddingProvider._MODEL.get_sentence_embedding_dimension()
                except Exception:
                    self.embedding_dim = None
        self._loaded = True

    async def embed_text(self, text: str) -> List[float]:
        res = await self.embed_texts([text])
        return res[0] if res else []

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        await self._ensure_loaded()
        try:
            # Run encode in a thread to avoid blocking
            emb = await asyncio.to_thread(LocalEmbeddingProvider._MODEL.encode, texts, show_progress_bar=False, convert_to_numpy=True)
            # emb is numpy.ndarray shape (N, D)
            # convert to python lists
            out = [row.tolist() for row in emb]
            # set embedding_dim if unknown
            if self.embedding_dim is None and len(out) and len(out[0]):
                self.embedding_dim = len(out[0])
            logger.debug("Generated %d embeddings (dim=%s)", len(out), self.embedding_dim)
            return out
        except Exception as exc:
            logger.exception("Local embedding generation failed: %s", exc)
            raise
