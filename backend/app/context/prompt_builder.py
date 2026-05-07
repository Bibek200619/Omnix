from __future__ import annotations

import logging
from typing import List, Dict, Any

from .schemas import AssembledContext, Citation, ContextSourceType
from .citations import CitationManager
from ..services.workspace_cognition import build_workspace_focus_prompt, normalize_workspace_focus

logger = logging.getLogger(__name__)


class PromptBuilder:
    """
    Unified Intelligence Assembly layer.
    Transforms raw citations and queries into a high-fidelity operational prompt.
    """

    def __init__(self, citation_manager: CitationManager):
        self.citation_manager = citation_manager

    def build_prompt(
        self, 
        query: str, 
        citations: List[Citation], 
        system_instructions: str = "",
        specialization: str | None = None
    ) -> AssembledContext:
        """Assemble final prompt from query, citations, and workspace cognitive posture."""
        
        # 1. Workspace Cognitive Posture Directive
        workspace_focus = normalize_workspace_focus(specialization)
        posture_directive = build_workspace_focus_prompt(workspace_focus)
        
        # 2. Workspace Profile Directive (if present in citations)
        workspace_citations = [c for c in citations if c.source_type == ContextSourceType.WORKSPACE]
        other_citations = [c for c in citations if c.source_type != ContextSourceType.WORKSPACE]
        
        context_block = self.citation_manager.format_citations_block(other_citations)
        workspace_block = self.citation_manager.format_citations_block(workspace_citations)
        
        prompt_parts = []
        
        # Primary System Identity & Global Mandates
        system_block = [
            "You are Omnix, a unified operational intelligence environment.",
            "You are currently operating within a specialized team workspace.",
            "",
            "CORE WORKSPACE COGNITION:",
            posture_directive,
            "",
            "IDENTITY & PRIVACY:",
            "- Your knowledge is strictly scoped to the provided context and the current workspace.",
            "- Citations are required for any claims based on retrieved data.",
            "- If context is insufficient, state the missing information clearly.",
        ]
        
        if system_instructions:
            system_block.append(f"\nADDITIONAL MANDATES:\n{system_instructions}")
            
        prompt_parts.append(f"<system_instructions>\n{'\n'.join(system_block)}\n</system_instructions>")
            
        # Workspace Intelligence (The 'Worldview')
        if workspace_block:
            prompt_parts.append(f"<workspace_intelligence>\n{workspace_block}\n</workspace_intelligence>")
            
        # Situational Context (Memory, Retrieval, Actions)
        if context_block:
            prompt_parts.append(f"<contextual_memory>\n{context_block}\n</contextual_memory>")
            
        # User Interaction
        prompt_parts.append(f"<user_query>\n{query}\n</user_query>")
        
        final_prompt = "\n\n".join(prompt_parts)
        
        return AssembledContext(
            prompt=final_prompt,
            citations=citations,
            diagnostics={
                "citations_count": len(citations),
                "workspace_focus": workspace_focus,
            },
            token_usage={}
        )
