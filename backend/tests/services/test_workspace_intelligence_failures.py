from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.context import engine as engine_module
from app.context.engine import ContextEngine, ContextRetrievalUnavailableError
from app.context.retrieval import RetrievalOutcome
from app.context.schemas import ContextPayload
from app.routers import actions, insights, messages, workspaces
from app.services import (
    message_retrieval_support,
    workspace_intelligence_service as intelligence,
)
from app.services.supabase_service import SupabaseServiceError
from app.services.workspace_common import WorkspaceAccess

PRIVATE_ERROR = "private-source-content-and-db-credential"
SOURCE_TABLES = [
    "files",
    "conversations",
    "workspace_initiatives",
    "workspace_intelligence_memory",
    "members",
]


@pytest.fixture
def profile_reads(monkeypatch):
    workspace = {"id": "workspace-1", "user_id": "user-1", "name": "Release"}
    access = WorkspaceAccess(workspace=workspace, role="member")
    monkeypatch.setattr(intelligence, "_intelligence_profile_cache", {})
    monkeypatch.setattr(
        intelligence, "require_workspace_access", AsyncMock(return_value=access)
    )
    monkeypatch.setattr(
        intelligence,
        "workspace_retrieval_scope_ids",
        AsyncMock(return_value=["workspace-1"]),
    )
    members = AsyncMock(return_value=[])
    reads = AsyncMock(return_value=[])
    monkeypatch.setattr(intelligence, "list_workspace_members", members)
    monkeypatch.setattr(intelligence, "select_all_trusted", reads)

    def fail(table):
        if table == "members":
            members.side_effect = HTTPException(500, PRIVATE_ERROR)
        else:

            async def select(current_table, *args, **kwargs):
                if current_table == table:
                    raise SupabaseServiceError(PRIVATE_ERROR)
                return []

            reads.side_effect = select

    return SimpleNamespace(fail=fail, reads=reads, members=members, access=access)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", SOURCE_TABLES)
async def test_real_profile_read_failure_is_503_and_not_cached(
    profile_reads, table, caplog
):
    profile_reads.fail(table)
    with pytest.raises(HTTPException) as exc:
        await intelligence.build_workspace_intelligence_profile("workspace-1", "user-1")
    assert exc.value.status_code == 503
    assert PRIVATE_ERROR not in str(exc.value.detail) + caplog.text
    assert intelligence._intelligence_profile_cache == {}

    # Recovery must execute real reads again, rather than return cached false absence.
    profile_reads.reads.side_effect = None
    profile_reads.members.side_effect = None
    result = await intelligence.build_workspace_intelligence_profile(
        "workspace-1", "user-1"
    )
    assert result["source_count"] == 0
    assert result["recent_insights"] == ["No knowledge sources are connected yet."]
    assert ("workspace-1", "user-1") in intelligence._intelligence_profile_cache


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [403, 404])
async def test_member_authorization_errors_are_preserved(profile_reads, code):
    profile_reads.members.side_effect = HTTPException(code, "Access denied.")
    with pytest.raises(HTTPException) as exc:
        await intelligence.build_workspace_intelligence_profile("workspace-1", "user-1")
    assert exc.value.status_code == code
    assert intelligence._intelligence_profile_cache == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("table", SOURCE_TABLES)
async def test_intelligence_api_uses_real_builder_and_returns_failure(
    profile_reads, table
):
    profile_reads.fail(table)
    with pytest.raises(HTTPException) as exc:
        await workspaces.get_workspace_intelligence("workspace-1", {"sub": "user-1"})
    assert exc.value.status_code == 503


@pytest.fixture
def real_profile_engine(monkeypatch, profile_reads):
    engine = ContextEngine()
    engine.actions_manager = SimpleNamespace(
        fetch_actions_context=Mock(return_value=[])
    )
    engine.automations_manager = SimpleNamespace(
        fetch_automations_context=Mock(return_value=[])
    )
    engine.memory_manager = SimpleNamespace(fetch_memory=AsyncMock(return_value=[]))
    engine.retrieval_manager = SimpleNamespace(
        retrieve=AsyncMock(
            return_value=RetrievalOutcome(
                outcome="no_relevant_sources",
                diagnostics={"outcome": "no_relevant_sources", "failed_channels": []},
            )
        )
    )
    monkeypatch.setattr(engine_module, "select_one_trusted", AsyncMock(return_value={}))
    monkeypatch.setattr(
        "app.services.supabase_service.select_all_trusted", AsyncMock(return_value=[])
    )
    return engine


@pytest.mark.asyncio
@pytest.mark.parametrize("table", SOURCE_TABLES)
async def test_nested_failure_reaches_context_diagnostics_and_report_gate(
    profile_reads, real_profile_engine, table, caplog
):
    profile_reads.fail(table)
    result = await real_profile_engine.build_context(
        ContextPayload(
            query="Summarize evidence", user_id="user-1", workspace_id="workspace-1"
        )
    )
    assert result.diagnostics["context_sources"]["workspace"] == "failed"
    assert result.diagnostics["retrieval_outcome"] == "partial"
    assert PRIVATE_ERROR not in result.prompt + str(result.diagnostics) + caplog.text
    with pytest.raises(ContextRetrievalUnavailableError):
        await real_profile_engine.assemble(
            "Summarize evidence", "user-1", "workspace-1"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["action", "insights"])
async def test_reports_reject_nested_failure_before_model_or_persistence(
    monkeypatch, profile_reads, real_profile_engine, endpoint
):
    profile_reads.fail("files")
    model = AsyncMock(
        side_effect=AssertionError("must not generate with failed context")
    )
    persist = AsyncMock(side_effect=AssertionError("must not persist a report"))
    request = SimpleNamespace(
        state=SimpleNamespace(user={"sub": "user-1"}),
        headers={"X-Omnix-Workspace": "workspace-1"},
    )
    monkeypatch.setattr("app.services.supabase_service.insert_one", persist)
    if endpoint == "action":
        monkeypatch.setattr(
            actions, "ContextEngine", lambda *a, **k: real_profile_engine
        )
        monkeypatch.setattr(actions, "require_workspace_access", AsyncMock())
        monkeypatch.setattr(actions.summarize_action, "call_llm", model)
        run = actions.run_action(request, actions.ActionRequest(action="summarize"))
    else:
        monkeypatch.setattr(
            insights, "ContextEngine", lambda *a, **k: real_profile_engine
        )
        monkeypatch.setattr(insights, "require_workspace_access", AsyncMock())
        monkeypatch.setattr(insights.workspace_summary, "call_llm", model)
        monkeypatch.setattr(insights, "insert_one", persist)
        run = insights.generate_insights(request, "workspace-1", {"sub": "user-1"})
    with pytest.raises(HTTPException) as exc:
        await run
    assert exc.value.status_code == 503
    model.assert_not_awaited()
    persist.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,code",
    [
        (RuntimeError(PRIVATE_ERROR), 503),
        (HTTPException(500, PRIVATE_ERROR), 503),
        (HTTPException(403, "Access denied."), 403),
        (HTTPException(404, "Not found."), 404),
    ],
)
async def test_chat_adapter_never_silently_drops_failed_profile(error, code, caplog):
    builder = AsyncMock(side_effect=error)
    with pytest.raises(HTTPException) as exc:
        await message_retrieval_support.load_workspace_intelligence_for_chat(
            "workspace-1", "user-1", build_workspace_intelligence_profile_fn=builder
        )
    assert exc.value.status_code == code
    assert PRIVATE_ERROR not in str(exc.value.detail) + caplog.text


@pytest.mark.asyncio
async def test_private_chat_does_not_require_workspace_profile():
    builder = AsyncMock(side_effect=AssertionError("private chat has no workspace"))
    assert (
        await message_retrieval_support.load_workspace_intelligence_for_chat(
            None, "user-1", build_workspace_intelligence_profile_fn=builder
        )
        is None
    )
    builder.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("table", SOURCE_TABLES)
async def test_chat_routes_reject_real_profile_failure_before_pending_message(
    monkeypatch, profile_reads, stream, existing, table
):
    profile_reads.fail(table)
    monkeypatch.setattr(
        messages,
        "require_active_workspace_access",
        AsyncMock(return_value=profile_reads.access),
    )
    monkeypatch.setattr(messages, "_check_rate_limit", AsyncMock())
    conversation = {"id": "conversation-1", "workspace_id": "workspace-1"}
    create = AsyncMock(
        side_effect=AssertionError(
            "must not create a conversation after failed context"
        )
    )
    monkeypatch.setattr(messages, "insert_one", create)
    monkeypatch.setattr(
        messages,
        "require_conversation_access",
        AsyncMock(return_value=(conversation, profile_reads.access)),
    )
    monkeypatch.setattr(messages, "_load_recent_messages", AsyncMock(return_value=[]))
    pending = AsyncMock(
        side_effect=AssertionError("must not leave a pending assistant")
    )
    model = AsyncMock(
        side_effect=AssertionError("must not generate after failed profile")
    )
    monkeypatch.setattr(messages, "insert_many", pending)
    monkeypatch.setattr(messages, "call_llm", model)
    monkeypatch.setattr(messages, "call_llm_stream", model)
    request = Request(
        {"type": "http", "method": "POST", "path": "/chat", "headers": []}
    )
    endpoint = messages.chat_stream if stream else messages.chat
    with pytest.raises(HTTPException) as exc:
        await endpoint(
            request,
            messages.ChatRequest(
                message="Summarize evidence",
                search_mode="workspace",
                conversation_id="conversation-1" if existing else None,
            ),
            {"sub": "user-1"},
        )
    assert exc.value.status_code == 503
    pending.assert_not_awaited()
    model.assert_not_awaited()
    create.assert_not_awaited()
