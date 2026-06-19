from __future__ import annotations

from typing import Any

from ..models import ParsedDocument, ParsedSection


class TextParser:
    source_type = "text"

    def parse_bytes(
        self,
        data: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ParsedDocument:
        text = self._decode(data)
        doc_metadata = {
            "filename": filename,
            "content_type": content_type,
            "byte_size": len(data),
            **dict(metadata or {}),
        }
        return ParsedDocument(
            text=text,
            metadata={key: value for key, value in doc_metadata.items() if value is not None},
            sections=[ParsedSection(text=text, metadata={})] if text.strip() else [],
            source_type=self.source_type,
        )

    @staticmethod
    def _decode(data: bytes) -> str:
        for encoding in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                continue
        return data.decode("utf-8", errors="ignore")
