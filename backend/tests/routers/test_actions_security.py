from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from fastapi.testclient import TestClient

from app.routers import actions
from app.services.workspace_service import WorkspaceAccess


class _FakeAuthMiddleware(BaseHTTPMiddleware):
    """Middleware that sets request.state.user for testing the actions router
    which reads authentication from request.state directly instead of Depends."""

    def __init__(self, app: Any, user: dict[str, Any] | None = None) -> None:
        super().__init__(app)
        self._user = user

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        request.state.user = self._user
        return await call_next(request)


def _client(
    user: dict[str, Any] | None = None,
    workspace_header: str | None = None,
) -> TestClient:
    app = FastAPI()
    app.add_middleware(_FakeAuthMiddleware, user=user)
    app.include_router(actions.router)
    client = TestClient(app, raise_server_exceptions=False)
    if workspace_header:
        client.headers["X-Omnix-Workspace"] = workspace_header
    return client


# ---- Unauthenticated ----


def test_unauthenticated_returns_401() -> None:
    client = _client(user=None, workspace_header="ws-1")
    response = client.post("/actions/run", json={"action": "summarize"})
    assert response.status_code == 401


# ---- Missing workspace header ----


def test_missing_workspace_header_returns_400() -> None:
    client = _client(user={"sub": "user-1", "role": "authenticated"})
    response = client.post("/actions/run", json={"action": "summarize"})
    assert response.status_code == 400


# ---- Non-member workspace ----


def test_non_member_workspace_returns_404(monkeypatch: pytest.MonkeyPatch) -> None:
    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    monkeypatch.setattr(actions, "require_workspace_access", deny_access)
    client = _client(user={"sub": "outsider", "role": "authenticated"}, workspace_header="ws-1")
    response = client.post("/actions/run", json={"action": "summarize"})
    assert response.status_code == 404


# ---- Valid member ----


def test_valid_member_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_access = WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-1"}, role="member")

    async def allow_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return mock_access

    monkeypatch.setattr(actions, "require_workspace_access", allow_access)

    # Mock the vector store and action execution
    monkeypatch.setattr(actions, "get_vector_store", lambda: MagicMock())
    monkeypatch.setattr(actions, "ContextEngine", lambda *a, **kw: MagicMock())

    async def fake_summarize_run(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"markdown": "Summary text", "citations": []}

    monkeypatch.setattr(actions.summarize_action, "run", fake_summarize_run)

    client = _client(user={"sub": "user-1", "role": "authenticated"}, workspace_header="ws-1")
    response = client.post("/actions/run", json={"action": "summarize"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "completed"
