from __future__ import annotations

import re
from typing import Any

from ..models import ParsedDocument, ParsedSection
from .text_parser import TextParser

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


class MarkdownParser(TextParser):
    source_type = "markdown"

    def parse_bytes(
        self,
        data: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ParsedDocument:
        text = self._decode(data)
        headings = [
            {"level": len(match.group(1)), "text": match.group(2).strip()}
            for match in _HEADING_RE.finditer(text)
        ]
        doc_metadata = {
            "filename": filename,
            "content_type": content_type,
            "byte_size": len(data),
            "headings": headings[:50],
            **dict(metadata or {}),
        }
        return ParsedDocument(
            text=text,
            metadata={key: value for key, value in doc_metadata.items() if value is not None},
            sections=[ParsedSection(text=text, metadata={"format": "markdown"})] if text.strip() else [],
            source_type=self.source_type,
        )
