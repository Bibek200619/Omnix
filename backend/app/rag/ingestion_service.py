from __future__ import annotations

import os
from typing import Any, Protocol

from .models import IngestionResult, ParsedDocument
from .parsers import MarkdownParser, PdfParser, TextParser
from .startup import get_vector_store
from .ingestion import RAGIngestionPipeline


class DocumentParser(Protocol):
    source_type: str

    def parse_bytes(
        self,
        data: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ParsedDocument:
        ...


def parser_for_file(filename: str | None, content_type: str | None = None) -> DocumentParser:
    suffix = os.path.splitext((filename or "").lower())[1]
    normalized_type = (content_type or "").lower()

    if suffix == ".pdf" or "pdf" in normalized_type:
        return PdfParser()
    if suffix in {".md", ".markdown"} or "markdown" in normalized_type:
        return MarkdownParser()
    return TextParser()


def parse_document_bytes(
    data: bytes,
    *,
    filename: str | None = None,
    content_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ParsedDocument:
    parser = parser_for_file(filename, content_type)
    return parser.parse_bytes(
        data,
        filename=filename,
        content_type=content_type,
        metadata=metadata,
    )


class DocumentIngestionService:
    """High-level parser + chunker + embedding orchestration service."""

    def __init__(self, pipeline: RAGIngestionPipeline | None = None) -> None:
        self.pipeline = pipeline or RAGIngestionPipeline(get_vector_store())

    async def ingest_bytes(
        self,
        data: bytes,
        *,
        user_id: str,
        file_id: str | None = None,
        workspace_id: str | None = None,
        filename: str | None = None,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
        replace_existing: bool = True,
    ) -> IngestionResult:
        parsed = parse_document_bytes(
            data,
            filename=filename,
            content_type=content_type,
            metadata=metadata,
        )
        return await self.pipeline.ingest_parsed_document(
            parsed,
            user_id=user_id,
            document_id=file_id,
            workspace_id=workspace_id,
            replace_existing=replace_existing,
        )
