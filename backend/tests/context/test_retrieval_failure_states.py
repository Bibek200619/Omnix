from __future__ import annotations

import pytest

from backend.app.context import retrieval as context_retrieval
from backend.app.context.engine import ContextEngine, ContextRetrievalUnavailableError
from backend.app.context.retrieval import RetrievalManager, RetrievalOutcome
from backend.app.context.schemas import ContextPayload


class _EmptyActions:
    def fetch_actions_context(self, _payload):
        return []


class _EmptyAutomations:
    def fetch_automations_context(self, _payload):
        return []


class _EmptyWorkspace:
    async def fetch_workspace_context(self, _payload):
        return []


class _EmptyMemory:
    async def fetch_memory(self, _payload):
        return []


def _engine_with_retrieval(retrieval_manager) -> ContextEngine:
    engine = ContextEngine()
    engine.actions_manager = _EmptyActions()
    engine.automations_manager = _EmptyAutomations()
    engine.workspace_manager = _EmptyWorkspace()
    engine.memory_manager = _EmptyMemory()
    engine.retrieval_manager = retrieval_manager
    return engine


@pytest.mark.asyncio
async def test_context_engine_exposes_retrieval_failure_and_blocks_generation() -> None:
    class FailingRetrieval:
        async def retrieve(self, _payload):
            return RetrievalOutcome(
                outcome="failed",
                diagnostics={
                    "outcome": "failed",
                    "reason": "channel_timeout",
                    "failed_channels": ["semantic", "keyword"],
                },
            )

    engine = _engine_with_retrieval(FailingRetrieval())
    payload = ContextPayload(query="Summarize workspace evidence", user_id="user-1")

    assembled = await engine.build_context(payload)

    assert assembled.diagnostics["retrieval"] == {
        "outcome": "failed",
        "reason": "channel_timeout",
        "failed_channels": ["semantic", "keyword"],
    }
    assert "Workspace source retrieval is temporarily unavailable." in assembled.prompt
    assert "Do not claim source-backed certainty" in assembled.prompt

    with pytest.raises(ContextRetrievalUnavailableError):
        await engine.assemble("Summarize workspace evidence", "user-1")


@pytest.mark.asyncio
async def test_context_engine_runs_retrieval_after_optional_context_failure() -> None:
    class NoSourceRetrieval:
        called = False

        async def retrieve(self, _payload):
            self.called = True
            return RetrievalOutcome(
                outcome="no_relevant_sources",
                diagnostics={
                    "outcome": "no_relevant_sources",
                    "reason": "no_matches",
                    "failed_channels": [],
                },
            )

    class FailingMemory:
        async def fetch_memory(self, _payload):
            raise RuntimeError("memory provider internal detail")

    retrieval = NoSourceRetrieval()
    engine = _engine_with_retrieval(retrieval)
    engine.memory_manager = FailingMemory()

    assembled = await engine.build_context(ContextPayload(query="Find workspace evidence", user_id="user-1"))

    assert retrieval.called is True
    assert assembled.diagnostics["context_sources"]["memory"] == "failed"
    assert assembled.diagnostics["retrieval"]["outcome"] == "no_relevant_sources"
    assert "memory provider internal detail" not in str(assembled.diagnostics)


@pytest.mark.asyncio
async def test_retrieval_manager_reports_routing_failure_explicitly(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail_routing(_payload):
        raise RuntimeError("routing provider internal detail")

    manager = RetrievalManager.__new__(RetrievalManager)
    monkeypatch.setattr(context_retrieval.intelligence_router, "route_query", fail_routing)

    outcome = await manager.retrieve(ContextPayload(query="Find evidence", user_id="user-1", workspace_id="workspace-1"))

    assert outcome.citations == []
    assert outcome.outcome == "failed"
    assert outcome.diagnostics == {
        "outcome": "failed",
        "reason": "routing_unavailable",
        "failed_channels": ["routing"],
    }
