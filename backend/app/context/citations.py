from __future__ import annotations

import logging
from typing import List, Dict

from .schemas import Citation
from ..services.prompt_trust import make_untrusted_data_record, untrusted_data_block

logger = logging.getLogger(__name__)


class CitationManager:
    """Centralized citation management and provenance tracking."""

    def __init__(self):
        pass

    def deduplicate_citations(self, citations: List[Citation]) -> List[Citation]:
        """Remove exact duplicates by source_id while preserving the highest score."""
        seen: Dict[str, Citation] = {}
        for c in citations:
            if not c.source_id:
                continue
                
            if c.source_id in seen:
                if c.score > seen[c.source_id].score:
                    seen[c.source_id] = c
            else:
                seen[c.source_id] = c
                
        return list(seen.values())

    def format_citations_block(self, citations: List[Citation], *, section_title: str = "CONTEXT SOURCES:") -> str:
        """Format citations into a standard string block for prompts."""
        if not citations:
            return ""

        records = []
        for idx, citation in enumerate(citations, 1):
            if citation.file_name and citation.file_name != "Unknown File":
                title = citation.file_name
            else:
                title = citation.source_type.value
                
            records.append(
                make_untrusted_data_record(
                    kind=f"{citation.source_type.value}_source",
                    content=citation.content.strip(),
                    label=f"[S{idx}]",
                    source_id=citation.source_id,
                    source_type=citation.source_type.value,
                    title=title,
                    file_id=citation.file_id,
                    score=citation.score,
                )
            )
            
        return untrusted_data_block(section_title, records)
