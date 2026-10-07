from __future__ import annotations

import logging
import time
from typing import Any

from .schemas import ContextPayload, AssembledContext
from .retrieval import RetrievalManager, RetrievalOutcome
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


class ContextRetrievalUnavailableError(RuntimeError):
    """Prevent a report when retrieval or another context source is unavailable."""

    def __init__(self) -> None:
        super().__init__("Workspace source retrieval is temporarily unavailable.")


class ContextEngine:
    """
    Centralized intelligence orchestration layer for the Omnix platform.
    Unifies retrieval, memory, actions, citations, and prompt assembly.
    """

    def __init__(self, vector_store=None, *, max_chunks: int | None = None):
        # ``max_chunks`` is retained for the existing actions endpoint. Context
        # assembly owns its token budget, so it is not a second retrieval limit.
        _ = max_chunks
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
        source_statuses: dict[str, str] = {}
        retrieval_outcome = RetrievalOutcome(
            outcome="failed",
            diagnostics={"outcome": "failed", "reason": "context_initialization", "failed_channels": ["context"]},
        )

        # 1. Gather Context Sources
        try:
            # Actions & Automations (highest priority/system context)
            action_cites = self.actions_manager.fetch_actions_context(payload) or []
            for c in action_cites:
                c.score = 1.0 # High priority
            raw_citations.extend(action_cites)
            source_statuses["actions"] = "ok"
        except Exception:
            logger.warning("ContextEngine failed while gathering action context.")
            source_statuses["actions"] = "failed"

        try:
            auto_cites = self.automations_manager.fetch_automations_context(payload) or []
            for c in auto_cites:
                c.score = 1.0
            raw_citations.extend(auto_cites)
            source_statuses["automations"] = "ok"
        except Exception:
            logger.warning("ContextEngine failed while gathering automation context.")
            source_statuses["automations"] = "failed"

        try:
            # Workspace Intelligence & Hierarchy
            # Refactored to use build_workspace_intelligence_profile internally
            ws_cites = await self.workspace_manager.fetch_workspace_context(payload)
            raw_citations.extend(ws_cites)
            source_statuses["workspace"] = "ok"
        except Exception:
            logger.warning("ContextEngine failed while gathering workspace context.")
            source_statuses["workspace"] = "failed"

        try:
            # Optimization: Fetch focus for PromptBuilder
            if payload.workspace_id:
                ws = await select_one_trusted(
                    "workspaces", "workspace_focus,ai_specialization", {"id": payload.workspace_id}
                )
                if ws:
                    workspace_focus = normalize_workspace_focus(
                        ws.get("workspace_focus") or ws.get("ai_specialization")
                    )
        except Exception:
            logger.warning("ContextEngine failed while loading workspace focus.")
            source_statuses["workspace_focus"] = "failed"

        try:
            # Memory (recent convos & current convo history)
            # Refactored to include Synthesized Workspace Memory
            mem_cites = await self.memory_manager.fetch_memory(payload)
            raw_citations.extend(mem_cites)
            source_statuses["memory"] = "ok"
        except Exception:
            logger.warning("ContextEngine failed while gathering memory.")
            source_statuses["memory"] = "failed"

        try:
            # Semantic / Keyword Hybrid Retrieval
            retrieval_outcome = await self.retrieval_manager.retrieve(payload)
            raw_citations.extend(retrieval_outcome.citations)
            source_statuses["retrieval"] = retrieval_outcome.outcome
        except Exception:
            logger.warning("ContextEngine failed during retrieval.")
            retrieval_outcome = RetrievalOutcome(
                outcome="failed",
                diagnostics={"outcome": "failed", "reason": "context_retrieval_unavailable", "failed_channels": ["context"]},
            )
            source_statuses["retrieval"] = "failed"

        # 2. Ranking
        ranked_citations = self.ranking_engine.rank(raw_citations)

        # 3. Citations Management (Deduplication)
        deduped_citations = self.citation_manager.deduplicate_citations(ranked_citations)

        # 4. Compression (Semantic overlap removal)
        compressed_citations = self.compressor.compress(deduped_citations)

        # 5. Token Budget Enforcement
        budgeted_citations = self.budget_engine.enforce_budget(compressed_citations)

        # 6. Prompt Assembly (with Operational Persona)
        prompt_retrieval_outcome = retrieval_outcome.outcome
        if (
            prompt_retrieval_outcome != "failed"
            and "failed" in source_statuses.values()
        ):
            # A working vector/keyword search does not establish complete context.
            prompt_retrieval_outcome = "partial"
        assembled_context = self.prompt_builder.build_prompt(
            payload.query,
            budgeted_citations,
            system_instructions,
            specialization=workspace_focus,
            retrieval_outcome=prompt_retrieval_outcome,
        )

        latency_ms = (time.perf_counter() - started_at) * 1000

        # 7. Add Diagnostics
        assembled_context.diagnostics.update({
            "latency_ms": round(latency_ms, 2),
            "total_citations_gathered": len(raw_citations),
            "citations_after_dedupe": len(deduped_citations),
            "citations_after_budget": len(budgeted_citations),
            "tokens_estimated": sum(self.budget_engine.estimate_tokens(c.content) for c in budgeted_citations),
            "retrieval": retrieval_outcome.diagnostics,
            "context_sources": source_statuses,
        })

        return assembled_context

    async def assemble(self, query: str, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
        """
        Backward compatibility adapter for the old ContextEngine.assemble() API.
        """
        payload = ContextPayload(
            query=query, user_id=user_id, workspace_id=workspace_id
        )
        assembled = await self.build_context(payload)
        retrieval = assembled.diagnostics.get("retrieval")
        retrieval_state = (
            retrieval if isinstance(retrieval, dict) else {"outcome": "failed"}
        )
        if (
            retrieval_state.get("outcome") == "failed"
            or "failed" in assembled.diagnostics.get("context_sources", {}).values()
        ):
            raise ContextRetrievalUnavailableError()

        return {
            "prompt": assembled.prompt,
            "sources": [c.to_dict() for c in assembled.citations],
            "chunks": [c.content for c in assembled.citations if c.source_type == "retrieval"],
            "retrieval": {
                **retrieval_state,
                "results": [c.to_dict() for c in assembled.citations if c.source_type == "retrieval"],
            },
            "diagnostics": assembled.diagnostics
        }
