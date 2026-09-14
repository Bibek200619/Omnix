from __future__ import annotations

import io
from typing import Any

from ..models import ParsedDocument, ParsedSection


class PdfParser:
    source_type = "pdf"

    def parse_bytes(
        self,
        data: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ParsedDocument:
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("PDF parsing requires the pypdf package.") from exc

        reader = PdfReader(io.BytesIO(data))
        sections: list[ParsedSection] = []
        pages: list[str] = []

        for page_index, page in enumerate(reader.pages):
            try:
                page_text = page.extract_text() or ""
            except Exception:
                page_text = ""
            if not page_text.strip():
                continue
            pages.append(page_text)
            sections.append(
                ParsedSection(
                    text=page_text,
                    metadata={"page": page_index + 1},
                )
            )

        doc_metadata = {
            "filename": filename,
            "content_type": content_type,
            "byte_size": len(data),
            "page_count": len(reader.pages),
            **dict(metadata or {}),
        }
        return ParsedDocument(
            text="\n\n".join(pages),
            metadata={key: value for key, value in doc_metadata.items() if value is not None},
            sections=sections,
            source_type=self.source_type,
        )
