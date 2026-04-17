from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from .token_utils import count_tokens, split_by_token_window, tail_tokens

DEFAULT_CHUNK_SIZE = 700
DEFAULT_OVERLAP = 120
DEFAULT_MIN_CHUNK_SIZE = 150

_PARAGRAPH_SPLIT_RE = re.compile(r"\n{2,}")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_MARKDOWN_HEADING_RE = re.compile(r"(?m)^(#{1,6}\s+.+)$")


@dataclass(slots=True, frozen=True)
class ChunkingConfig:
    chunk_size: int = DEFAULT_CHUNK_SIZE
    overlap: int = DEFAULT_OVERLAP
    min_chunk_size: int = DEFAULT_MIN_CHUNK_SIZE

    def validate(self) -> None:
        if self.chunk_size <= 0:
            raise ValueError("chunk_size must be greater than 0.")
        if self.overlap < 0:
            raise ValueError("overlap cannot be negative.")
        if self.overlap >= self.chunk_size:
            raise ValueError("overlap must be smaller than chunk_size.")
        if self.min_chunk_size < 0:
            raise ValueError("min_chunk_size cannot be negative.")


def normalize_text(text: str) -> str:
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+\n", "\n", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def chunk_text(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
    min_chunk_size: int = DEFAULT_MIN_CHUNK_SIZE,
    metadata: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Token-aware sliding-window chunking with semantic boundary preference.

    The returned dictionaries are ready to be carried into the ingestion layer;
    `split_text_into_chunks` remains as a compatibility wrapper for older code.
    """
    config = ChunkingConfig(
        chunk_size=chunk_size,
        overlap=overlap,
        min_chunk_size=min_chunk_size,
    )
    config.validate()

    normalized = normalize_text(text)
    if not normalized:
        return []

    base_metadata = dict(metadata or {})
    units = _semantic_units(normalized, config)
    chunk_contents = _pack_units(units, config)
    chunk_contents = _merge_small_trailing_chunk(chunk_contents, config)

    chunks: list[dict[str, Any]] = []
    for index, content in enumerate(chunk_contents):
        cleaned = content.strip()
        if not cleaned:
            continue
        token_count = count_tokens(cleaned)
        chunks.append(
            {
                "content": cleaned,
                "chunk_index": len(chunks),
                "token_count": token_count,
                "metadata": {
                    **base_metadata,
                    "chunk_index": len(chunks),
                    "chunk_token_count": token_count,
                    "chunk_char_count": len(cleaned),
                    "chunk_size": config.chunk_size,
                    "chunk_overlap": config.overlap,
                    "chunking_strategy": "token_sliding_window",
                },
            }
        )

    return chunks


def split_text_into_chunks(text: str) -> list[str]:
    """Backward-compatible text-only chunk API used by retrieval fallbacks."""
    return [chunk["content"] for chunk in chunk_text(text)]


def _semantic_units(text: str, config: ChunkingConfig) -> list[str]:
    paragraphs = _paragraphs_with_markdown_boundaries(text)
    units: list[str] = []

    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue

        if count_tokens(paragraph) <= config.chunk_size:
            units.append(paragraph)
            continue

        sentences = [part.strip() for part in _SENTENCE_SPLIT_RE.split(paragraph) if part.strip()]
        if len(sentences) <= 1:
            units.extend(
                split_by_token_window(
                    paragraph,
                    chunk_size=config.chunk_size,
                    overlap=config.overlap,
                )
            )
            continue

        for sentence in sentences:
            if count_tokens(sentence) <= config.chunk_size:
                units.append(sentence)
            else:
                units.extend(
                    split_by_token_window(
                        sentence,
                        chunk_size=config.chunk_size,
                        overlap=config.overlap,
                    )
                )

    return units


def _paragraphs_with_markdown_boundaries(text: str) -> list[str]:
    protected = _MARKDOWN_HEADING_RE.sub(r"\n\n\1\n\n", text)
    return [part.strip() for part in _PARAGRAPH_SPLIT_RE.split(protected) if part.strip()]


def _pack_units(units: list[str], config: ChunkingConfig) -> list[str]:
    chunks: list[str] = []
    current_parts: list[str] = []
    carry_is_overlap = False

    for unit in units:
        candidate = _join_parts([*current_parts, unit])
        if current_parts and count_tokens(candidate) > config.chunk_size:
            current_text = _join_parts(current_parts)
            if not carry_is_overlap:
                chunks.append(current_text)
            budget = config.chunk_size - count_tokens(unit)
            if budget > 0:
                budget -= count_tokens("\n\n")
            overlap_budget = max(budget, 0)
            overlap_text = tail_tokens(current_text, min(config.overlap, overlap_budget))
            current_parts = [overlap_text] if overlap_text else []
            carry_is_overlap = bool(overlap_text)

        if count_tokens(unit) > config.chunk_size:
            if current_parts and not carry_is_overlap:
                chunks.append(_join_parts(current_parts))
            current_parts = []
            carry_is_overlap = False
            windows = split_by_token_window(
                unit,
                chunk_size=config.chunk_size,
                overlap=config.overlap,
            )
            chunks.extend(windows)
            overlap_text = tail_tokens(windows[-1], config.overlap) if windows else ""
            current_parts = [overlap_text] if overlap_text else []
            carry_is_overlap = bool(overlap_text)
            continue

        current_parts.append(unit)
        carry_is_overlap = False

    if current_parts:
        if not carry_is_overlap:
            chunks.append(_join_parts(current_parts))

    return [chunk for chunk in chunks if chunk.strip()]


def _merge_small_trailing_chunk(chunks: list[str], config: ChunkingConfig) -> list[str]:
    if len(chunks) < 2:
        return chunks

    last = chunks[-1].strip()
    if count_tokens(last) >= config.min_chunk_size:
        return chunks

    previous = chunks[-2].strip()
    merged = _join_parts([previous, last])
    if count_tokens(merged) <= config.chunk_size:
        return [*chunks[:-2], merged]

    return chunks


def _join_parts(parts: list[str]) -> str:
    return "\n\n".join(part.strip() for part in parts if part and part.strip()).strip()
