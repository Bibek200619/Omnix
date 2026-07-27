from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.routers import actions, continuity, insights, messages, workspace_conversations, workspace_tasks
from app.context.engine import ContextRetrievalUnavailableError
from app.services.chat_service import ModelServiceError


class DummyRequest:
    state = SimpleNamespace(user={"sub": "user-1"})
    headers: dict[str, str] = {"X-Omnix-Workspace": "workspace-1"}


def assert_detail_is_sanitized(exc: HTTPException, expected: str) -> None:
    assert exc.detail == expected
    assert "raw" not in str(exc.detail).lower()
    assert "postgres" not in str(exc.detail).lower()
    assert "ollama" not in str(exc.detail).lower()


@pytest.mark.asyncio
async def test_actions_sanitize_runtime_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken_action(*args, **kwargs):
        raise RuntimeError("raw postgres password leaked")

    async def allow_access(*args, **kwargs): return object()
    monkeypatch.setattr(actions, "require_workspace_access", allow_access)
    monkeypatch.setattr(actions, "get_vector_store", lambda: object())
    monkeypatch.setattr(actions, "ContextEngine", lambda *args, **kwargs: object())
    monkeypatch.setattr(actions.summarize_action, "run", broken_action)

    with pytest.raises(HTTPException) as exc_info:
        await actions.run_action(DummyRequest(), actions.ActionRequest(action="summarize"))

    assert exc_info.value.status_code == 500
    assert_detail_is_sanitized(exc_info.value, "Unable to perform action.")


@pytest.mark.asyncio
async def test_actions_do_not_generate_when_workspace_retrieval_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    async def unavailable_action(*args, **kwargs):
        raise ContextRetrievalUnavailableError()

    async def allow_access(*args, **kwargs):
        return object()

    monkeypatch.setattr(actions, "require_workspace_access", allow_access)
    monkeypatch.setattr(actions, "get_vector_store", lambda: object())
    monkeypatch.setattr(actions, "ContextEngine", lambda *args, **kwargs: object())
    monkeypatch.setattr(actions.summarize_action, "run", unavailable_action)

    with pytest.raises(HTTPException) as exc_info:
        await actions.run_action(DummyRequest(), actions.ActionRequest(action="summarize"))

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Workspace source retrieval is temporarily unavailable. Please retry shortly."


@pytest.mark.asyncio
async def test_insights_sanitize_generation_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def allow_access(*args, **kwargs):
        return object()

    async def broken_summary(*args, **kwargs):
        raise RuntimeError("raw postgres schema failure")

    monkeypatch.setattr(insights, "require_workspace_access", allow_access)
    monkeypatch.setattr(insights.workspace_summary, "run", broken_summary)

    with pytest.raises(HTTPException) as exc_info:
        await insights.generate_insights(DummyRequest(), "workspace-1", {"sub": "user-1"})

    assert exc_info.value.status_code == 500
    assert_detail_is_sanitized(exc_info.value, "Unable to generate workspace insights.")


@pytest.mark.asyncio
async def test_insights_persist_validated_citation_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def allow_access(*args, **kwargs):
        return object()

    async def validated_result(*args, **kwargs):
        return {
            "markdown": "Verified workspace finding [S1].",
            "structured_text": "Verified workspace finding [S1].",
            "citations": [{"label": "S1", "source_id": "release-plan"}],
            "citation_validation": {
                "status": "supported",
                "source_count": 1,
                "cited_source_count": 1,
                "invalid_citation_count": 0,
            },
        }

    async def fake_insert_one(table: str, payload: dict[str, object]) -> dict[str, str]:
        assert table == "artifacts"
        captured.update(payload)
        return {"id": "artifact-1"}

    monkeypatch.setattr(insights, "require_workspace_access", allow_access)
    monkeypatch.setattr(insights, "ContextEngine", lambda: object())
    monkeypatch.setattr(insights.workspace_summary, "run", validated_result)
    monkeypatch.setattr(insights.topic_detection, "run", validated_result)
    monkeypatch.setattr(insights.action_item_detector, "run", validated_result)
    monkeypatch.setattr(insights.conflict_detector, "run", validated_result)
    monkeypatch.setattr(insights, "insert_one", fake_insert_one)

    response = await insights.generate_insights(DummyRequest(), "workspace-1", {"sub": "user-1"})

    assert response["artifact_id"] == "artifact-1"
    assert captured["metadata"] == {
        "summary_structured": "Verified workspace finding [S1].",
        "topics_structured": "Verified workspace finding [S1].",
        "actions_structured": "Verified workspace finding [S1].",
        "conflicts_structured": "Verified workspace finding [S1].",
        "citations": {
            "summary": [{"label": "S1", "source_id": "release-plan"}],
            "topics": [{"label": "S1", "source_id": "release-plan"}],
            "actions": [{"label": "S1", "source_id": "release-plan"}],
            "conflicts": [{"label": "S1", "source_id": "release-plan"}],
        },
        "citation_validation": {
            "summary": {"status": "supported", "source_count": 1, "cited_source_count": 1, "invalid_citation_count": 0},
            "topics": {"status": "supported", "source_count": 1, "cited_source_count": 1, "invalid_citation_count": 0},
            "actions": {"status": "supported", "source_count": 1, "cited_source_count": 1, "invalid_citation_count": 0},
            "conflicts": {"status": "supported", "source_count": 1, "cited_source_count": 1, "invalid_citation_count": 0},
        },
    }


@pytest.mark.asyncio
async def test_continuity_sanitizes_timeline_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken_timeline(*args, **kwargs):
        raise RuntimeError("raw timeline query failure")

    monkeypatch.setattr(continuity, "get_continuity_timeline", broken_timeline)

    with pytest.raises(HTTPException) as exc_info:
        await continuity.get_workspace_timeline(
            workspace_id=UUID("00000000-0000-0000-0000-000000000001"),
            user={"sub": "00000000-0000-0000-0000-000000000002"},
        )

    assert exc_info.value.status_code == 500
    assert_detail_is_sanitized(exc_info.value, "Workspace continuity is unavailable.")


@pytest.mark.asyncio
async def test_task_assistance_sanitizes_model_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_tasks(*args, **kwargs):
        return [{"title": "Ship", "status": "active", "blockers": []}]

    async def broken_model(*args, **kwargs):
        raise ModelServiceError("raw ollama endpoint failed", 503)

    async def allow_access(*args, **kwargs): return object()
    async def allow_rate_limit(*args, **kwargs): return None
    monkeypatch.setattr(workspace_tasks, "require_workspace_access", allow_access)
    monkeypatch.setattr(workspace_tasks, "enforce_expensive_ai_rate_limit", allow_rate_limit)
    monkeypatch.setattr(workspace_tasks, "task_transcript_for_assistance", fake_tasks)
    monkeypatch.setattr(workspace_tasks, "generate_ai_response", broken_model)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_tasks.assist_execution(
            workspace_id="workspace-1",
            request=workspace_tasks.WorkspaceTaskAssistanceRequest(mode="blockers"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 503
    assert_detail_is_sanitized(exc_info.value, "Task assistance is unavailable.")


@pytest.mark.asyncio
async def test_conversation_assistance_sanitizes_model_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_messages(*args, **kwargs):
        return [{"author_name": "Alex", "content": "Confirm launch"}]

    async def broken_model(*args, **kwargs):
        raise ModelServiceError("raw ollama endpoint failed", 503)

    async def allow_rate_limit(*args, **kwargs): return None
    monkeypatch.setattr(workspace_conversations, "enforce_expensive_ai_rate_limit", allow_rate_limit)
    monkeypatch.setattr(workspace_conversations, "channel_transcript_for_assistance", fake_messages)
    monkeypatch.setattr(workspace_conversations, "generate_ai_response", broken_model)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_conversations.assist_channel_discussion(
            workspace_id="workspace-1",
            channel_id="channel-1",
            request=workspace_conversations.WorkspaceConversationAssistanceRequest(mode="summary"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 503
    assert_detail_is_sanitized(exc_info.value, "Conversation assistance is unavailable.")


@pytest.mark.asyncio
async def test_ai_generation_sanitizes_model_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken_model(*args, **kwargs):
        raise ModelServiceError("raw ollama endpoint failed", 503)

    async def allow_rate_limit(*args, **kwargs):
        return None

    monkeypatch.setattr(messages, "_check_rate_limit", allow_rate_limit)
    monkeypatch.setattr(messages, "generate_ai_response", broken_model)

    with pytest.raises(HTTPException) as exc_info:
        await messages.generate_ai(
            payload=messages.AIGenerationRequest(prompt="Summarize"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 503
    assert_detail_is_sanitized(exc_info.value, "AI generation is unavailable.")
