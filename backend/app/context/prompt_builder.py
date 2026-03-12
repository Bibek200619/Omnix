from __future__ import annotations

import logging
from typing import List, Dict, Any

from .schemas import AssembledContext, Citation
from .citations import CitationManager

logger = logging.getLogger(__name__)


class PromptBuilder:
    """Provider-independent prompt assembly."""

    def __init__(self, citation_manager: CitationManager):
        self.citation_manager = citation_manager

    def build_prompt(self, query: str, citations: List[Citation], system_instructions: str = "") -> AssembledContext:
        """Assemble final prompt from query and citations."""
        context_block = self.citation_manager.format_citations_block(citations)
        
        prompt_parts = []
        if system_instructions:
            prompt_parts.append(f"<system_instructions>\n{system_instructions}\n</system_instructions>")
            
        if context_block:
            prompt_parts.append(f"<context>\n{context_block}\n</context>")
            
        prompt_parts.append(f"<user_query>\n{query}\n</user_query>")
        
        final_prompt = "\n\n".join(prompt_parts)
        
        # Token usage would ideally be tracked via TokenBudgetEngine metrics, 
        # passing an empty dict for now.
        return AssembledContext(
            prompt=final_prompt,
            citations=citations,
            diagnostics={"citations_count": len(citations)},
            token_usage={}
        )
