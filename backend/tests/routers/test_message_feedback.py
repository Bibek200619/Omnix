from __future__ import annotations

from typing import Any

import pytest

from app.routers import messages
from app.schemas.chat import MessageFeedbackCreate


@pytest.mark.asyncio
async def test_submit_message_feedback_persists_assistant_feedback(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    activity: list[dict[str, Any]] = []

    async def allow_conversation(conversation_id: str, user_id: str):
        return {"id": conversation_id, "workspace_id": "workspace-1"}, object()

    async def fake_select_one(table: str, columns: str, filters: dict[str, Any]):
        assert table == "messages"
        assert filters == {"id": "assistant-1", "conversation_id": "conversation-1"}
        return {
            "id": "assistant-1",
            "conversation_id": "conversation-1",
            "user_id": "author-1",
            "role": "assistant",
        }

    async def fake_upsert(table: str, payload: dict[str, Any], on_conflict: str):
        captured["table"] = table
        captured["payload"] = payload
        captured["on_conflict"] = on_conflict
        return {"id": "feedback-1", **payload}

    async def fake_activity(**kwargs):
        activity.append(kwargs)
        return kwargs

    monkeypatch.setattr(messages, "require_conversation_access", allow_conversation)
    monkeypatch.setattr(messages, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(messages, "upsert_one", fake_upsert)
    monkeypatch.setattr(messages, "log_workspace_activity", fake_activity)

    result = await messages.submit_message_feedback(
        "conversation-1",
        "assistant-1",
        MessageFeedbackCreate(rating="bad", reason="Citation was wrong."),
        current_user={"sub": "user-1"},
    )

    assert result["id"] == "feedback-1"
    assert captured["table"] == "message_feedback"
    assert captured["on_conflict"] == "message_id,user_id"
    assert captured["payload"]["conversation_id"] == "conversation-1"
    assert captured["payload"]["message_id"] == "assistant-1"
    assert captured["payload"]["user_id"] == "user-1"
    assert captured["payload"]["workspace_id"] == "workspace-1"
    assert captured["payload"]["rating"] == "bad"
    assert captured["payload"]["reason"] == "Citation was wrong."
    assert activity[0]["event_type"] == "workspace.ai_feedback_submitted"
