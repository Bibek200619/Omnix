from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.context import engine as engine_module
from app.context.engine import ContextEngine, ContextRetrievalUnavailableError
from app.context.memory import MemoryManager
from app.context import memory as memory_module
from app.context.retrieval import RetrievalOutcome
from app.context.schemas import Citation, ContextPayload, ContextSourceType
from app.context.workspace_context import WorkspaceContextManager
from app.routers import actions, insights


@pytest.fixture
def source_failure_engine(monkeypatch: pytest.MonkeyPatch):
    def make(failed_source: str, outcome: str = "sources_found") -> ContextEngine:
        engine = ContextEngine()
        engine.actions_manager = SimpleNamespace(
            fetch_actions_context=Mock(return_value=[])
        )
        engine.automations_manager = SimpleNamespace(
            fetch_automations_context=Mock(return_value=[])
        )
        engine.workspace_manager = SimpleNamespace(
            fetch_workspace_context=AsyncMock(return_value=[])
        )
        engine.memory_manager = SimpleNamespace(fetch_memory=AsyncMock(return_value=[]))
        monkeypatch.setattr(
            engine_module, "select_one_trusted", AsyncMock(return_value={})
        )

        async def select(table, *args, **kwargs):
            if table == failed_source:
                raise RuntimeError("private-source-content-and-db-secret")
            return []

        monkeypatch.setattr("app.services.supabase_service.select_all_trusted", select)
        monkeypatch.setattr(memory_module, "require_workspace_access", AsyncMock())
        monkeypatch.setattr(
            "app.services.supabase_service.select_one_trusted",
            AsyncMock(return_value={"id": "conversation-1"}),
        )
        profile = AsyncMock(return_value={})
        if failed_source == "profile":
            profile.side_effect = RuntimeError("private-source-content-and-db-secret")
        monkeypatch.setattr(
            "app.services.workspace_intelligence_service.build_workspace_intelligence_profile",
            profile,
        )
        monkeypatch.setattr(
            "app.services.workspace_intelligence_service.workspace_intelligence_system_prompt",
            lambda *a, **k: "profile",
        )

        if failed_source in {
            "workspace_intelligence_memory",
            "messages",
            "conversations",
        }:
            engine.memory_manager = MemoryManager()
        elif failed_source in {"profile", "artifacts"}:
            engine.workspace_manager = WorkspaceContextManager()
        else:
            target, method = {
                "actions": (engine.actions_manager, "fetch_actions_context"),
                "automations": (
                    engine.automations_manager,
                    "fetch_automations_context",
                ),
                "workspace_focus": (engine_module, "select_one_trusted"),
            }[failed_source]
            getattr(target, method).side_effect = RuntimeError(
                "private-source-content-and-db-secret"
            )

        cites = [
            Citation(
                source_id="chunk-1",
                source_type=ContextSourceType.RETRIEVAL,
                content="Verified source.",
            )
        ]
        engine.retrieval_manager = SimpleNamespace(
            retrieve=AsyncMock(
                return_value=RetrievalOutcome(
                    citations=cites if outcome == "sources_found" else [],
                    outcome=outcome,
                    diagnostics={
                        "outcome": outcome,
                        "reason": "sources_found"
                        if outcome == "sources_found"
                        else "no_matches",
                        "failed_channels": [],
                    },
                )
            )
        )
        return engine

    return make


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "source,component",
    [
        ("workspace_intelligence_memory", "memory"),
        ("messages", "memory"),
        ("conversations", "memory"),
        ("profile", "workspace"),
        ("artifacts", "workspace"),
        ("actions", "actions"),
        ("automations", "automations"),
        ("workspace_focus", "workspace_focus"),
    ],
)
@pytest.mark.parametrize("outcome", ["sources_found", "no_relevant_sources"])
async def test_context_source_failure_is_explicit_before_generation(
    source_failure_engine,
    source: str,
    component: str,
    outcome: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    engine = source_failure_engine(source, outcome)
    assembled = await engine.build_context(
        ContextPayload(
            query="Summarize evidence",
            user_id="user-1",
            workspace_id="workspace-1",
            conversation_id="conversation-1",
        )
    )

    assert assembled.diagnostics["context_sources"][component] == "failed"
    assert assembled.diagnostics["retrieval"]["outcome"] == outcome
    assert assembled.diagnostics["retrieval_outcome"] == "partial"
    assert "do not imply complete workspace coverage" in assembled.prompt
    assert "private-source-content" not in assembled.prompt + str(assembled.diagnostics)
    assert "private-source-content" not in caplog.text
    assert engine.retrieval_manager.retrieve.await_count == 1

    # Conversation memory is requested only by build_context above; assemble
    # has no conversation argument. The other source failures reach both paths.
    if source != "messages":
        with pytest.raises(ContextRetrievalUnavailableError):
            await engine.assemble("Summarize evidence", "user-1", "workspace-1")


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["action", "insights"])
async def test_report_endpoints_return_503_without_model_or_persistence(
    monkeypatch: pytest.MonkeyPatch,
    source_failure_engine,
    endpoint: str,
) -> None:
    engine = source_failure_engine("workspace_intelligence_memory")
    model = AsyncMock(
        side_effect=AssertionError("incomplete context must not call model")
    )
    persist = AsyncMock(
        side_effect=AssertionError("incomplete report must not persist")
    )
    request = SimpleNamespace(
        state=SimpleNamespace(user={"sub": "user-1"}),
        headers={"X-Omnix-Workspace": "workspace-1"},
    )
    monkeypatch.setattr("app.services.supabase_service.insert_one", persist)

    if endpoint == "action":
        monkeypatch.setattr(actions, "ContextEngine", lambda *a, **k: engine)
        monkeypatch.setattr(actions, "require_workspace_access", AsyncMock())
        monkeypatch.setattr(actions.summarize_action, "call_llm", model)
        run = actions.run_action(request, actions.ActionRequest(action="summarize"))
    else:
        monkeypatch.setattr(insights, "ContextEngine", lambda *a, **k: engine)
        monkeypatch.setattr(insights, "require_workspace_access", AsyncMock())
        monkeypatch.setattr(insights.workspace_summary, "call_llm", model)
        monkeypatch.setattr(insights, "insert_one", persist)
        run = insights.generate_insights(request, "workspace-1", {"sub": "user-1"})

    with pytest.raises(HTTPException) as exc:
        await run
    assert exc.value.status_code == 503
    assert "private-source-content" not in exc.value.detail
    model.assert_not_awaited()
    persist.assert_not_awaited()


@pytest.mark.asyncio
async def test_healthy_empty_context_is_not_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = ContextEngine()
    monkeypatch.setattr(memory_module, "require_workspace_access", AsyncMock())
    monkeypatch.setattr(
        "app.services.supabase_service.select_all_trusted", AsyncMock(return_value=[])
    )
    engine.workspace_manager = SimpleNamespace(
        fetch_workspace_context=AsyncMock(return_value=[])
    )
    monkeypatch.setattr(engine_module, "select_one_trusted", AsyncMock(return_value={}))
    engine.retrieval_manager = SimpleNamespace(
        retrieve=AsyncMock(
            return_value=RetrievalOutcome(
                outcome="no_relevant_sources",
                diagnostics={
                    "outcome": "no_relevant_sources",
                    "reason": "no_matches",
                    "failed_channels": [],
                },
            )
        )
    )
    assembled = await engine.assemble("Find evidence", "user-1", "workspace-1")
    assert assembled["retrieval"]["outcome"] == "no_relevant_sources"
    assert "failed" not in assembled["diagnostics"]["context_sources"].values()
