from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, status

from app.routers import continuity, workspace_conversations, workspace_decisions, workspace_tasks
from app.services.workspace_service import WorkspaceAccess


async def _allow_workspace_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
    return WorkspaceAccess(workspace={"id": workspace_id, "user_id": "owner-1"}, role="member")


def _rate_limit_denial(captured: dict[str, Any]):
    async def deny_rate_limit(*, user_id: str, workspace_id: str | None, endpoint: str) -> None:
        captured.update({"user_id": user_id, "workspace_id": workspace_id, "endpoint": endpoint})
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")

    return deny_rate_limit


@pytest.mark.asyncio
async def test_task_assistance_rate_limit_blocks_provider_call(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    provider = AsyncMock()

    async def fake_tasks(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [{"title": "Ship", "status": "active", "blockers": []}]

    monkeypatch.setattr(workspace_tasks, "require_workspace_access", _allow_workspace_access)
    monkeypatch.setattr(workspace_tasks, "task_transcript_for_assistance", fake_tasks)
    monkeypatch.setattr(workspace_tasks, "enforce_expensive_ai_rate_limit", _rate_limit_denial(captured))
    monkeypatch.setattr(workspace_tasks, "generate_ai_response", provider)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_tasks.assist_execution(
            workspace_id="ws-1",
            request=workspace_tasks.WorkspaceTaskAssistanceRequest(mode="blockers"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 429
    assert captured == {"user_id": "user-1", "workspace_id": "ws-1", "endpoint": "workspace.tasks.assist"}
    provider.assert_not_awaited()


@pytest.mark.asyncio
async def test_channel_assistance_rate_limit_blocks_provider_call(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    provider = AsyncMock()

    async def fake_messages(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [{"author_name": "Alex", "content": "Confirm launch"}]

    monkeypatch.setattr(workspace_conversations, "channel_transcript_for_assistance", fake_messages)
    monkeypatch.setattr(workspace_conversations, "enforce_expensive_ai_rate_limit", _rate_limit_denial(captured))
    monkeypatch.setattr(workspace_conversations, "generate_ai_response", provider)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_conversations.assist_channel_discussion(
            workspace_id="ws-1",
            channel_id="channel-1",
            request=workspace_conversations.WorkspaceConversationAssistanceRequest(mode="summary"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 429
    assert captured == {"user_id": "user-1", "workspace_id": "ws-1", "endpoint": "workspace.channels.assist"}
    provider.assert_not_awaited()


@pytest.mark.asyncio
async def test_initiative_assistance_rate_limit_blocks_provider_call(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    provider = AsyncMock()
    initiative = {
        "title": "Launch",
        "status": "active",
        "owner_name": None,
        "owner_email": None,
        "target_date": None,
        "description": "Coordinate launch.",
        "initiative_context": None,
        "linked_resources": [],
        "linked_tasks": [],
        "linked_channels": [],
        "momentum": {"health": "active_movement"},
    }

    async def fake_evidence(*_args: Any, **_kwargs: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        return initiative, []

    monkeypatch.setattr(continuity, "initiative_evidence_for_assistance", fake_evidence)
    monkeypatch.setattr(continuity, "enforce_expensive_ai_rate_limit", _rate_limit_denial(captured))
    monkeypatch.setattr(continuity, "generate_ai_response", provider)

    with pytest.raises(HTTPException) as exc_info:
        await continuity.assist_workspace_initiative(
            workspace_id="ws-1",
            initiative_id="init-1",
            request=continuity.WorkspaceInitiativeAssistanceRequest(mode="state"),
            user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 429
    assert captured == {"user_id": "user-1", "workspace_id": "ws-1", "endpoint": "workspace.initiatives.assist"}
    provider.assert_not_awaited()


@pytest.mark.asyncio
async def test_decision_candidate_rate_limit_blocks_extraction(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    extraction = AsyncMock(side_effect=AssertionError("candidate extraction must not run"))

    monkeypatch.setattr(workspace_decisions, "require_workspace_access", _allow_workspace_access)
    monkeypatch.setattr(workspace_decisions, "enforce_expensive_ai_rate_limit", _rate_limit_denial(captured))
    monkeypatch.setattr(workspace_decisions, "conversation_decision_candidates", extraction)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_decisions.post_conversation_decision_candidates(
            workspace_id="ws-1",
            channel_id="channel-1",
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 429
    assert captured == {
        "user_id": "user-1",
        "workspace_id": "ws-1",
        "endpoint": "workspace.decisions.candidates.conversation",
    }
    extraction.assert_not_awaited()


@pytest.mark.asyncio
async def test_document_candidate_rate_limit_blocks_extraction(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    extraction = AsyncMock(side_effect=AssertionError("document candidate extraction must not run"))

    monkeypatch.setattr(workspace_decisions, "require_workspace_access", _allow_workspace_access)
    monkeypatch.setattr(workspace_decisions, "enforce_expensive_ai_rate_limit", _rate_limit_denial(captured))
    monkeypatch.setattr(workspace_decisions, "document_decision_candidates", extraction)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_decisions.post_document_decision_candidates(
            workspace_id="ws-1",
            file_id="file-1",
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 429
    assert captured == {
        "user_id": "user-1",
        "workspace_id": "ws-1",
        "endpoint": "workspace.decisions.candidates.document",
    }
    extraction.assert_not_awaited()
