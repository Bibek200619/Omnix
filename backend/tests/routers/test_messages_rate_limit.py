from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, status
from starlette.requests import Request

from app.routers import messages
from app.services.workspace_service import WorkspaceAccess


def _request(path: str = "/chat") -> Request:
    return Request({"type": "http", "method": "POST", "path": path, "headers": []})


@pytest.mark.asyncio
async def test_chat_rate_limit_uses_resolved_workspace_before_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def active_workspace_access(_request: Request, user_id: str) -> WorkspaceAccess:
        assert user_id == "user-1"
        return WorkspaceAccess(workspace={"id": "ws-1", "user_id": "owner-1"}, role="member")

    async def deny_rate_limit(user_id: str, *, workspace_id: str | None, endpoint: str) -> None:
        captured.update({"user_id": user_id, "workspace_id": workspace_id, "endpoint": endpoint})
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")

    async def fail_insert(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("rate-limited chat must not create a conversation")

    monkeypatch.setattr(messages, "require_active_workspace_access", active_workspace_access)
    monkeypatch.setattr(messages, "_check_rate_limit", deny_rate_limit)
    monkeypatch.setattr(messages, "insert_one", fail_insert)

    with pytest.raises(HTTPException) as exc_info:
        await messages.chat(
            request=_request(),
            payload=messages.ChatRequest(message="hello"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 429
    assert captured == {"user_id": "user-1", "workspace_id": "ws-1", "endpoint": messages.CHAT_RATE_LIMIT_ENDPOINT}


@pytest.mark.asyncio
async def test_chat_stream_rate_limit_runs_before_message_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def deny_rate_limit(user_id: str, *, workspace_id: str | None, endpoint: str) -> None:
        captured.update({"user_id": user_id, "workspace_id": workspace_id, "endpoint": endpoint})
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")

    monkeypatch.setattr(messages, "_check_rate_limit", deny_rate_limit)
    monkeypatch.setattr(messages, "insert_one", AsyncMock(side_effect=AssertionError("conversation insert must not run")))
    monkeypatch.setattr(messages, "insert_many", AsyncMock(side_effect=AssertionError("message insert must not run")))

    with pytest.raises(HTTPException) as exc_info:
        await messages.chat_stream(
            request=_request("/chat/stream"),
            payload=messages.ChatRequest(message="hello"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 429
    assert captured == {
        "user_id": "user-1",
        "workspace_id": None,
        "endpoint": messages.CHAT_STREAM_RATE_LIMIT_ENDPOINT,
    }
