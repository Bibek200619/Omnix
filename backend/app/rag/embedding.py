from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

# Lazy-loaded singleton model instance
_MODEL = None
_EMBEDDING_EXECUTOR: ThreadPoolExecutor | None = None
MODEL_NAME = "all-MiniLM-L6-v2"

# Provider selection via environment variable: 'local' (sentence-transformers) or 'openai'
import os

logger = logging.getLogger(__name__)


def _get_executor() -> ThreadPoolExecutor:
    global _EMBEDDING_EXECUTOR
    if _EMBEDDING_EXECUTOR is None:
        _EMBEDDING_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="embedding_worker")
    return _EMBEDDING_EXECUTOR


def _get_local_model() -> Any:
    global _MODEL
    if _MODEL is None:
        try:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading local embedding model: %s", MODEL_NAME)
            _MODEL = SentenceTransformer(MODEL_NAME)
        except ImportError as exc:
            logger.error("sentence-transformers is not installed.")
            raise RuntimeError("sentence-transformers library is required for local embeddings.") from exc
        except Exception as exc:
            logger.exception("Failed to load embedding model: %s", MODEL_NAME)
            raise RuntimeError(f"Failed to load embedding model {MODEL_NAME}") from exc
    return _MODEL


def _openai_embed(texts: list[str]) -> list[list[float]]:
    try:
        import openai
    except Exception as exc:
        logger.exception("openai library not available for embeddings")
        raise RuntimeError("OpenAI client is required for openai embedding provider") from exc

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set for openai embedding provider")
    openai.api_key = api_key

    model = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    # OpenAI accepts lists for embeddings endpoint in recent APIs
    embeddings: list[list[float]] = []
    for text in texts:
        if not text or not text.strip():
            embeddings.append([])
            continue
        resp = openai.Embedding.create(model=model, input=text.strip())
        vec = resp.data[0].embedding
        embeddings.append(vec)
    return embeddings


def get_embedding(text: str) -> list[float]:
    if not text or not text.strip():
        return []

    provider = os.environ.get("EMBEDDING_PROVIDER", "local").lower()
    try:
        if provider == "openai":
            return _openai_embed([text])[0]
        # default to local
        model = _get_local_model()
        embedding = model.encode(text.strip())
        return embedding.tolist()
    except Exception as exc:
        logger.exception("Failed to generate embedding for text.")
        raise RuntimeError("Embedding generation failed.") from exc


def get_embeddings(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    provider = os.environ.get("EMBEDDING_PROVIDER", "local").lower()
    cleaned_texts = [text.strip() for text in texts]
    try:
        if provider == "openai":
            return _openai_embed(cleaned_texts)
        model = _get_local_model()
        embeddings = model.encode(cleaned_texts)
        return embeddings.tolist()
    except Exception as exc:
        logger.exception("Failed to generate batch embeddings.")
        raise RuntimeError("Batch embedding generation failed.") from exc


async def get_embeddings_async(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    try:
        loop = asyncio.get_running_loop()
        executor = _get_executor()
        return await loop.run_in_executor(executor, get_embeddings, texts)
    except Exception as exc:
        logger.exception("Failed to generate async embeddings.")
        raise RuntimeError("Async batch embedding generation failed.") from exc
