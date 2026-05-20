from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True, frozen=True)
class ParsedSection:
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True, frozen=True)
class ParsedDocument:
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)
    sections: list[ParsedSection] = field(default_factory=list)
    source_type: str = "document"


@dataclass(slots=True, frozen=True)
class DocumentChunk:
    content: str
    chunk_index: int
    token_count: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True, frozen=True)
class IngestionResult:
    chunk_count: int
    chunk_ids: list[str]
    skipped: bool = False
