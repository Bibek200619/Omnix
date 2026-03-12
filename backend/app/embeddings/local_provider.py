from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Any, List

from .dimensions import get_expected_embedding_dimension, validate_embeddings_dimension
from .provider import EmbeddingProvider

logger = logging.getLogger(__name__)


class LocalEmbeddingProvider(EmbeddingProvider):
    """Local embedding provider using sentence-transformers.

    Loads the model lazily in a thread to avoid blocking the event loop and
    shares a single model instance per process/model name.
    """

    _MODELS: dict[str, Any] = {}
    _MODEL_DIMS: dict[str, int] = {}
    _LOAD_LOCK = threading.RLock()

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or os.environ.get("LOCAL_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
        self.embedding_dim: int | None = LocalEmbeddingProvider._MODEL_DIMS.get(self.model_name)
        self.expected_dim = get_expected_embedding_dimension()
        self.batch_size = int(os.environ.get("LOCAL_EMBEDDING_BATCH_SIZE", "32"))
        self.normalize_embeddings = os.environ.get("LOCAL_EMBEDDING_NORMALIZE", "true").lower() not in {
            "0",
            "false",
            "no",
        }
        self.local_files_only = os.environ.get("LOCAL_EMBEDDING_LOCAL_FILES_ONLY", "false").lower() in {
            "1",
            "true",
            "yes",
        }
        self._loaded = False

    def _get_or_load_model_sync(self):
        """Return a shared sentence-transformers model, loading once per process."""
        with LocalEmbeddingProvider._LOAD_LOCK:
            existing = LocalEmbeddingProvider._MODELS.get(self.model_name)
            if existing is not None:
                self.embedding_dim = LocalEmbeddingProvider._MODEL_DIMS.get(self.model_name)
                return existing

            try:
                from sentence_transformers import SentenceTransformer
            except Exception as exc:
                logger.exception("sentence-transformers import failed: %s", exc)
                raise RuntimeError(
                    "Local embeddings require sentence-transformers and torch. "
                    "Install backend dependencies with: pip install -r backend/requirements.txt"
                ) from exc

            started_at = time.perf_counter()
            logger.info("Loading local embedding model '%s' with sentence-transformers.", self.model_name)
            try:
                model = SentenceTransformer(self.model_name, local_files_only=self.local_files_only)
            except Exception as exc:
                logger.exception("Failed to load local embedding model '%s': %s", self.model_name, exc)
                raise RuntimeError(
                    f"Failed to load local embedding model '{self.model_name}'. "
                    "If this is a fresh offline deployment, download/cache the model before "
                    "starting the worker or set LOCAL_EMBEDDING_MODEL to an available local path."
                ) from exc

            try:
                get_dimension = getattr(model, "get_embedding_dimension", None) or getattr(
                    model,
                    "get_sentence_embedding_dimension",
                )
                dim = int(get_dimension())
            except Exception as exc:
                raise RuntimeError(
                    f"Local embedding model '{self.model_name}' did not report an embedding dimension."
                ) from exc

            elapsed_ms = (time.perf_counter() - started_at) * 1000
            if dim != self.expected_dim:
                logger.error(
                    "Local embedding model '%s' dimension mismatch: model_dim=%d expected_dim=%d.",
                    self.model_name,
                    dim,
                    self.expected_dim,
                )
                raise RuntimeError(
                    f"Local embedding model '{self.model_name}' outputs {dim} dimensions, "
                    f"but the active DB/vector contract expects {self.expected_dim}. "
                    "Use all-MiniLM-L6-v2, set EMBEDDING_DIMENSION for a custom model, "
                    "and migrate pgvector before ingesting."
                )

            LocalEmbeddingProvider._MODELS[self.model_name] = model
            LocalEmbeddingProvider._MODEL_DIMS[self.model_name] = dim
            self.embedding_dim = dim
            logger.info(
                "Loaded local embedding model '%s' in %.1f ms (dimension=%d, normalized=%s, local_files_only=%s).",
                self.model_name,
                elapsed_ms,
                dim,
                self.normalize_embeddings,
                self.local_files_only,
            )
            return model

    async def _ensure_loaded(self):
        if self.model_name not in LocalEmbeddingProvider._MODELS:
            logger.debug("Local embedding model '%s' not loaded; loading in worker thread.", self.model_name)
            await asyncio.to_thread(self._get_or_load_model_sync)
        elif self.embedding_dim is None:
            self.embedding_dim = LocalEmbeddingProvider._MODEL_DIMS.get(self.model_name)
        self._loaded = True

    async def warmup(self) -> None:
        await self._ensure_loaded()

    async def embed_text(self, text: str) -> List[float]:
        res = await self.embed_texts([text])
        return res[0] if res else []

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        await self._ensure_loaded()
        try:
            model = LocalEmbeddingProvider._MODELS[self.model_name]
            started_at = time.perf_counter()
            emb = await asyncio.to_thread(
                model.encode,
                texts,
                batch_size=self.batch_size,
                show_progress_bar=False,
                convert_to_numpy=True,
                normalize_embeddings=self.normalize_embeddings,
            )
            out = [row.astype(float).tolist() for row in emb]
            validate_embeddings_dimension(out, expected_dim=self.expected_dim)
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.info(
                "Generated %d local embeddings in %.1f ms (dimension=%d).",
                len(out),
                elapsed_ms,
                self.expected_dim,
            )
            return out
        except Exception as exc:
            logger.exception("Local embedding generation failed: %s", exc)
            raise
