from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.routers import actions, continuity, insights, messages, workspace_conversations, workspace_tasks
from app.services.chat_service import ModelServiceError


class DummyRequest:
    state = SimpleNamespace(user={"sub": "user-1"})
    headers: dict[str, str] = {}


def assert_detail_is_sanitized(exc: HTTPException, expected: str) -> None:
    assert exc.detail == expected
    assert "raw" not in str(exc.detail).lower()
    assert "postgres" not in str(exc.detail).lower()
    assert "ollama" not in str(exc.detail).lower()


@pytest.mark.asyncio
async def test_actions_sanitize_runtime_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken_action(*args, **kwargs):
        raise RuntimeError("raw postgres password leaked")

    monkeypatch.setattr(actions, "get_vector_store", lambda: object())
    monkeypatch.setattr(actions, "ContextEngine", lambda *args, **kwargs: object())
    monkeypatch.setattr(actions.summarize_action, "run", broken_action)

    with pytest.raises(HTTPException) as exc_info:
        await actions.run_action(DummyRequest(), actions.ActionRequest(action="summarize"))

    assert exc_info.value.status_code == 500
    assert_detail_is_sanitized(exc_info.value, "Unable to perform action.")


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

    async def allow_request(user_id: str):
        return None

    monkeypatch.setattr(messages, "_check_rate_limit", allow_request)
    monkeypatch.setattr(messages, "generate_ai_response", broken_model)

    with pytest.raises(HTTPException) as exc_info:
        await messages.generate_ai(
            payload=messages.AIGenerationRequest(prompt="Summarize"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 503
    assert_detail_is_sanitized(exc_info.value, "AI generation is unavailable.")
