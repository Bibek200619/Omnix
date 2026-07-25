from __future__ import annotations

import logging
from typing import List

from .schemas import AssembledContext, Citation, ContextSourceType
from .citations import CitationManager
from ..services.prompt_trust import (
    UNTRUSTED_CONTENT_SYSTEM_POLICY,
    make_untrusted_data_record,
    untrusted_data_block,
)
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
        specialization: str | None = None,
        retrieval_outcome: str = "not_requested",
    ) -> AssembledContext:
        """Assemble final prompt from query, citations, and workspace cognitive posture."""
        retrieval_outcome = (
            retrieval_outcome
            if retrieval_outcome in {"not_requested", "sources_found", "no_relevant_sources", "partial", "failed"}
            else "failed"
        )
        
        # 1. Workspace Cognitive Posture Directive
        workspace_focus = normalize_workspace_focus(specialization)
        posture_directive = build_workspace_focus_prompt(workspace_focus)
        
        # 2. Workspace Profile Directive (if present in citations)
        workspace_citations = [c for c in citations if c.source_type == ContextSourceType.WORKSPACE]
        other_citations = [c for c in citations if c.source_type != ContextSourceType.WORKSPACE]
        
        context_block = self.citation_manager.format_citations_block(
            other_citations,
            section_title="CONTEXTUAL MEMORY AND RETRIEVAL SOURCES:",
        )
        workspace_block = self.citation_manager.format_citations_block(
            workspace_citations,
            section_title="WORKSPACE INTELLIGENCE SOURCES:",
        )
        
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
            "",
            UNTRUSTED_CONTENT_SYSTEM_POLICY,
        ]
        if retrieval_outcome == "partial":
            system_block.extend(
                [
                    "",
                    "RETRIEVAL COVERAGE:",
                    "- Some source-retrieval channels were unavailable.",
                    "- Use only the provided sources and do not imply complete workspace coverage.",
                ]
            )
        elif retrieval_outcome == "failed":
            system_block.extend(
                [
                    "",
                    "RETRIEVAL STATUS:",
                    "- Workspace source retrieval is temporarily unavailable.",
                    "- Do not claim source-backed certainty, cite workspace sources, or imply that documents were searched.",
                    "- Explain the limitation and ask the user to retry instead of producing a workspace report.",
                ]
            )
        
        if system_instructions:
            system_block.append(f"\nADDITIONAL MANDATES:\n{system_instructions}")
            
        prompt_parts.append(f"<system_instructions>\n{'\n'.join(system_block)}\n</system_instructions>")
            
        # Workspace Intelligence (The 'Worldview')
        if workspace_block:
            prompt_parts.append(
                "<workspace_intelligence_data classification=\"untrusted\">\n"
                f"{workspace_block}\n"
                "</workspace_intelligence_data>"
            )
            
        # Situational Context (Memory, Retrieval, Actions)
        if context_block:
            prompt_parts.append(
                "<contextual_memory_data classification=\"untrusted\">\n"
                f"{context_block}\n"
                "</contextual_memory_data>"
            )
            
        # User Interaction
        user_query_block = untrusted_data_block(
            "USER QUERY:",
            [
                make_untrusted_data_record(
                    kind="user_message",
                    content=(query or "").strip(),
                    source_type="user_query",
                )
            ],
        )
        prompt_parts.append(f"<user_query_data classification=\"untrusted\">\n{user_query_block}\n</user_query_data>")
        
        final_prompt = "\n\n".join(prompt_parts)
        
        return AssembledContext(
            prompt=final_prompt,
            citations=citations,
            diagnostics={
                "citations_count": len(citations),
                "workspace_focus": workspace_focus,
                "retrieval_outcome": retrieval_outcome,
            },
            token_usage={}
        )
