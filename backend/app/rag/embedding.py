from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

# Lazy-loaded singleton model instance
_MODEL = None
_EMBEDDING_EXECUTOR: ThreadPoolExecutor | None = None
MODEL_NAME = "all-MiniLM-L6-v2"

logger = logging.getLogger(__name__)


def _get_executor() -> ThreadPoolExecutor:
    """
    Returns a singleton ThreadPoolExecutor for embedding operations.
    Embeddings are CPU-bound and this executor prevents them from blocking the event loop.
    """
    global _EMBEDDING_EXECUTOR
    if _EMBEDDING_EXECUTOR is None:
        _EMBEDDING_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="embedding_worker")
    return _EMBEDDING_EXECUTOR


def _get_model() -> Any:
    """
    Lazily loads and returns the SentenceTransformer model.
    This ensures the model is initialized only once globally, preventing 
    costly reloads on every request while keeping import times fast.
    """
    global _MODEL
    if _MODEL is None:
        try:
            from sentence_transformers import SentenceTransformer
            
            logger.info("Loading embedding model: %s", MODEL_NAME)
            _MODEL = SentenceTransformer(MODEL_NAME)
        except ImportError as exc:
            logger.error("sentence-transformers is not installed.")
            raise RuntimeError("sentence-transformers library is required for embeddings.") from exc
        except Exception as exc:
            logger.exception("Failed to load embedding model: %s", MODEL_NAME)
            raise RuntimeError(f"Failed to load embedding model {MODEL_NAME}") from exc
            
    return _MODEL


def get_embedding(text: str) -> list[float]:
    """
    Generates an embedding vector for a single text string.

    Args:
        text (str): The input string to embed.

    Returns:
        list[float]: The generated embedding vector. Returns an empty list 
                     if the input string is empty or only whitespace.
    """
    if not text or not text.strip():
        return []

    try:
        model = _get_model()
        embedding = model.encode(text.strip())
        return embedding.tolist()
    except Exception as exc:
        logger.exception("Failed to generate embedding for text.")
        raise RuntimeError("Embedding generation failed.") from exc


def get_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generates embedding vectors for a list of text strings using batch processing.

    Args:
        texts (list[str]): The list of input strings to embed.

    Returns:
        list[list[float]]: A list of embedding vectors corresponding to the input texts.
                           If the input list is empty, returns an empty list.
    """
    if not texts:
        return []

    # Clean text to ensure consistent embedding quality
    cleaned_texts = [text.strip() for text in texts]

    try:
        model = _get_model()
        # SentenceTransformer inherently processes lists in batches efficiently
        embeddings = model.encode(cleaned_texts)
        return embeddings.tolist()
    except Exception as exc:
        logger.exception("Failed to generate batch embeddings.")
        raise RuntimeError("Batch embedding generation failed.") from exc


async def get_embeddings_async(texts: list[str]) -> list[list[float]]:
    """
    Async wrapper for batch embedding generation.
    Runs embedding in a threadpool to prevent blocking the event loop.
    
    Args:
        texts (list[str]): The list of input strings to embed.
    
    Returns:
        list[list[float]]: A list of embedding vectors corresponding to the input texts.
    """
    if not texts:
        return []
    
    try:
        loop = asyncio.get_running_loop()
        executor = _get_executor()
        return await loop.run_in_executor(executor, get_embeddings, texts)
    except Exception as exc:
        logger.exception("Failed to generate async embeddings.")
        raise RuntimeError("Async batch embedding generation failed.") from exc
