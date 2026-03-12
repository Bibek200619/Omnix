from __future__ import annotations

import logging
from typing import List, Dict

from .schemas import Citation

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

    def format_citations_block(self, citations: List[Citation]) -> str:
        """Format citations into a standard string block for prompts."""
        if not citations:
            return ""

        formatted = []
        for idx, citation in enumerate(citations, 1):
            if citation.file_name and citation.file_name != "Unknown File":
                header = f"[{idx}] Source: {citation.file_name}"
            else:
                header = f"[{idx}] Source: {citation.source_type.value}"
                
            formatted.append(f"{header}\n{citation.content.strip()}\n")
            
        return "\n".join(formatted)
