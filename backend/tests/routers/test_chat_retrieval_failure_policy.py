from __future__ import annotations

from typing import Any

import pytest
from starlette.requests import Request

from app.routers import messages
from app.services.workspace_common import WorkspaceAccess


def _request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/chat", "headers": []})


@pytest.mark.asyncio
async def test_chat_does_not_call_model_after_retrieval_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    async def allow_workspace(*_args: Any, **_kwargs: Any) -> WorkspaceAccess:
        return WorkspaceAccess(workspace={"id": "workspace-1", "user_id": "user-1"}, role="member")

    async def no_op(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def no_profile(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def fake_insert_one(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"id": "conversation-1", "user_id": "user-1", "workspace_id": "workspace-1"}

    async def fake_insert_many(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [
            {"id": "user-message-1", "conversation_id": "conversation-1", "user_id": "user-1", "role": "user", "content": "Summarize", "status": "completed"},
            {"id": "assistant-message-1", "conversation_id": "conversation-1", "user_id": "user-1", "role": "assistant", "content": "", "status": "pending"},
        ]

    async def failed_retrieval(*_args: Any, **_kwargs: Any):
        return (
            messages.message_retrieval_service.retrieval_unavailable_answer(),
            [],
            {"strategy": "retrieval_failed", "outcome": "failed", "reason": "channel_timeout", "failed_channels": ["semantic"]},
        )

    async def fail_model(*_args: Any, **_kwargs: Any) -> str:
        raise AssertionError("the model must not be called after source retrieval fails")

    async def fake_update(*_args: Any, **kwargs: Any) -> dict[str, Any]:
        return {
            "id": kwargs["assistant_message_id"],
            "conversation_id": "conversation-1",
            "user_id": "user-1",
            "role": "assistant",
            "content": kwargs["content"],
            "status": kwargs["status_value"],
            "payload": {
                "retrieval": {"outcome": "failed", "source_count": 0, "reason": "channel_timeout", "failed_channels": ["semantic"]}
            },
        }

    async def fake_hydrate(rows: list[dict[str, Any]], *_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return rows

    monkeypatch.setattr(messages, "require_active_workspace_access", allow_workspace)
    monkeypatch.setattr(messages, "_check_rate_limit", no_op)
    monkeypatch.setattr(messages, "insert_one", fake_insert_one)
    monkeypatch.setattr(messages, "insert_many", fake_insert_many)
    monkeypatch.setattr(messages, "_attach_files_to_conversation", no_op)
    monkeypatch.setattr(messages, "_load_workspace_intelligence_for_chat", no_profile)
    monkeypatch.setattr(messages, "_retrieve_prompt_context", failed_retrieval)
    monkeypatch.setattr(messages, "_persist_assistant_payload", no_op)
    monkeypatch.setattr(messages, "_log_ollama_prompt_debug", lambda **_kwargs: None)
    monkeypatch.setattr(messages, "call_llm", fail_model)
    monkeypatch.setattr(messages, "_update_assistant_message", fake_update)
    monkeypatch.setattr(messages, "_touch_conversation", no_op)
    monkeypatch.setattr(messages, "log_workspace_activity", no_op)
    monkeypatch.setattr(messages, "hydrate_conversation_history", fake_hydrate)

    response = await messages.chat(
        request=_request(),
        payload=messages.ChatRequest(message="Summarize the workspace", search_mode="workspace"),
        current_user={"sub": "user-1"},
    )

    assert response.response == messages.message_retrieval_service.retrieval_unavailable_answer()
    assert response.retrieval == {
        "outcome": "failed",
        "source_count": 0,
        "reason": "channel_timeout",
        "failed_channels": ["semantic"],
    }
