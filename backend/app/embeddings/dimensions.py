from __future__ import annotations

import logging
import os
from collections.abc import Sequence

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_DIMENSION = 384


def get_expected_embedding_dimension() -> int:
    """Return the configured embedding dimension for the active vector contract."""
    raw = os.environ.get("EMBEDDING_DIMENSION") or os.environ.get("EMBEDDING_DIM")
    if not raw:
        return DEFAULT_EMBEDDING_DIMENSION

    try:
        value = int(raw)
    except (TypeError, ValueError):
        logger.warning(
            "Invalid embedding dimension value %r; using default %d.",
            raw,
            DEFAULT_EMBEDDING_DIMENSION,
        )
        return DEFAULT_EMBEDDING_DIMENSION

    if value <= 0:
        logger.warning(
            "Embedding dimension must be positive, got %d; using default %d.",
            value,
            DEFAULT_EMBEDDING_DIMENSION,
        )
        return DEFAULT_EMBEDDING_DIMENSION
    return value


def embedding_dimension(embedding: Sequence[float] | None) -> int:
    return len(embedding) if embedding is not None else 0


def validate_embedding_dimension(
    embedding: Sequence[float],
    *,
    expected_dim: int | None = None,
    label: str = "embedding",
) -> None:
    expected = expected_dim or get_expected_embedding_dimension()
    actual = embedding_dimension(embedding)
    if actual != expected:
        raise ValueError(
            f"{label} dimension mismatch: expected {expected}, got {actual}. "
            "Apply the vector(384) migration and re-embed old documents before "
            "using vectors from another provider."
        )


def validate_embeddings_dimension(
    embeddings: Sequence[Sequence[float]],
    *,
    expected_dim: int | None = None,
    label: str = "embeddings",
) -> None:
    expected = expected_dim or get_expected_embedding_dimension()
    for index, embedding in enumerate(embeddings):
        actual = embedding_dimension(embedding)
        if actual != expected:
            raise ValueError(
                f"{label}[{index}] dimension mismatch: expected {expected}, got {actual}. "
                "Do not mix legacy OpenAI vectors with local all-MiniLM-L6-v2 vectors; "
                "run the safe re-embedding workflow after migrating the DB column."
            )
