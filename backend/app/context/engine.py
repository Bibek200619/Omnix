from __future__ import annotations

import logging
import time
from typing import Any, Dict

from .schemas import ContextPayload, AssembledContext, Citation
from .retrieval import RetrievalManager
from .memory import MemoryManager
from .workspace_context import WorkspaceContextManager
from .actions_context import ActionsContextManager
from .automations_context import AutomationsContextManager
from .ranking import RankingEngine
from .compression import ContextCompressor
from .citations import CitationManager
from .token_budget import TokenBudgetEngine
from .prompt_builder import PromptBuilder
from ..services.supabase_service import select_one_trusted
from ..services.workspace_cognition import normalize_workspace_focus

logger = logging.getLogger(__name__)


class ContextEngine:
    """
    Centralized intelligence orchestration layer for the Omnix platform.
    Unifies retrieval, memory, actions, citations, and prompt assembly.
    """

    def __init__(self, vector_store=None):
        self.retrieval_manager = RetrievalManager(vector_store)
        self.memory_manager = MemoryManager()
        self.workspace_manager = WorkspaceContextManager()
        self.actions_manager = ActionsContextManager()
        self.automations_manager = AutomationsContextManager()
        
        self.ranking_engine = RankingEngine()
        self.compressor = ContextCompressor()
        self.citation_manager = CitationManager()
        self.budget_engine = TokenBudgetEngine()
        self.prompt_builder = PromptBuilder(self.citation_manager)

    async def build_context(self, payload: ContextPayload, system_instructions: str = "") -> AssembledContext:
        """
        Orchestrate all context sources to build the final prompt payload.
        """
        started_at = time.perf_counter()
        raw_citations = []
        workspace_focus = None

        # 1. Gather Context Sources
        try:
            # Actions & Automations (highest priority/system context)
            action_cites = self.actions_manager.fetch_actions_context(payload)
            for c in action_cites:
                c.score = 1.0 # High priority
            raw_citations.extend(action_cites)
            
            auto_cites = self.automations_manager.fetch_automations_context(payload)
            for c in auto_cites:
                c.score = 1.0
            raw_citations.extend(auto_cites)

            # Workspace Intelligence & Hierarchy
            # Refactored to use build_workspace_intelligence_profile internally
            ws_cites = await self.workspace_manager.fetch_workspace_context(payload)
            raw_citations.extend(ws_cites)

            # Optimization: Fetch focus for PromptBuilder
            if payload.workspace_id:
                ws = await select_one_trusted(
                    "workspaces", "workspace_focus,ai_specialization", {"id": payload.workspace_id}
                )
                if ws:
                    workspace_focus = normalize_workspace_focus(
                        ws.get("workspace_focus") or ws.get("ai_specialization")
                    )

            # Memory (recent convos & current convo history)
            # Refactored to include Synthesized Workspace Memory
            mem_cites = await self.memory_manager.fetch_memory(payload)
            raw_citations.extend(mem_cites)

            # Semantic / Keyword Hybrid Retrieval
            retrieval_cites = await self.retrieval_manager.retrieve(payload)
            raw_citations.extend(retrieval_cites)

        except Exception:
            logger.exception("ContextEngine failed during context gathering.")

        # 2. Ranking
        ranked_citations = self.ranking_engine.rank(raw_citations)

        # 3. Citations Management (Deduplication)
        deduped_citations = self.citation_manager.deduplicate_citations(ranked_citations)

        # 4. Compression (Semantic overlap removal)
        compressed_citations = self.compressor.compress(deduped_citations)

        # 5. Token Budget Enforcement
        budgeted_citations = self.budget_engine.enforce_budget(compressed_citations)

        # 6. Prompt Assembly (with Operational Persona)
        assembled_context = self.prompt_builder.build_prompt(
            payload.query, 
            budgeted_citations, 
            system_instructions,
            specialization=workspace_focus
        )

        latency_ms = (time.perf_counter() - started_at) * 1000
        
        # 7. Add Diagnostics
        assembled_context.diagnostics.update({
            "latency_ms": round(latency_ms, 2),
            "total_citations_gathered": len(raw_citations),
            "citations_after_dedupe": len(deduped_citations),
            "citations_after_budget": len(budgeted_citations),
            "tokens_estimated": sum(self.budget_engine.estimate_tokens(c.content) for c in budgeted_citations),
        })

        return assembled_context

    async def assemble(self, query: str, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
        """
        Backward compatibility adapter for the old ContextEngine.assemble() API.
        """
        payload = ContextPayload(
            query=query,
            user_id=user_id,
            workspace_id=workspace_id
        )
        assembled = await self.build_context(payload)
        
        return {
            "prompt": assembled.prompt,
            "sources": [c.to_dict() for c in assembled.citations],
            "chunks": [c.content for c in assembled.citations if c.source_type == "retrieval"],
            "retrieval": {"results": [c.to_dict() for c in assembled.citations if c.source_type == "retrieval"]},
            "diagnostics": assembled.diagnostics
        }
