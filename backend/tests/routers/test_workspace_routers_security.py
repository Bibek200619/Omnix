from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.routers import workspace_tasks
from app.routers import workspace_decisions
from app.routers import workspace_mentions
from app.services.workspace_service import WorkspaceAccess


def _tasks_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    if current_user is not None:
        app.dependency_overrides[get_current_user] = lambda: current_user
    app.include_router(workspace_tasks.router)
    return TestClient(app, raise_server_exceptions=False)


def _decisions_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    if current_user is not None:
        app.dependency_overrides[get_current_user] = lambda: current_user
    app.include_router(workspace_decisions.router)
    return TestClient(app, raise_server_exceptions=False)


def _mentions_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    if current_user is not None:
        app.dependency_overrides[get_current_user] = lambda: current_user
    app.include_router(workspace_mentions.router)
    return TestClient(app, raise_server_exceptions=False)


# ---- workspace_tasks: non-member ----


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/workspaces/ws-1/tasks"),
        ("GET", "/workspaces/ws-1/tasks/momentum"),
        ("POST", "/workspaces/ws-1/tasks"),
    ],
)
def test_tasks_non_member_returns_404(method: str, path: str, monkeypatch: pytest.MonkeyPatch) -> None:
    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    monkeypatch.setattr(workspace_tasks, "require_workspace_access", deny_access)
    client = _tasks_client({"sub": "outsider", "role": "authenticated"})
    response = client.request(method, path, json={"title": "test", "status": "idea"})
    assert response.status_code == 404


# ---- workspace_decisions: non-member ----


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/workspaces/ws-1/decisions"),
        ("POST", "/workspaces/ws-1/decisions"),
        ("GET", "/workspaces/ws-1/decisions/d-1"),
    ],
)
def test_decisions_non_member_returns_404(method: str, path: str, monkeypatch: pytest.MonkeyPatch) -> None:
    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    monkeypatch.setattr(workspace_decisions, "require_workspace_access", deny_access)
    client = _decisions_client({"sub": "outsider", "role": "authenticated"})
    response = client.request(method, path, json={"title": "test", "status": "proposed"})
    assert response.status_code == 404


# ---- workspace_mentions: non-member ----


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/workspaces/ws-1/mentions"),
        ("GET", "/workspaces/ws-1/mentions/unread-count"),
        ("PATCH", "/workspaces/ws-1/mentions/read-all"),
    ],
)
def test_mentions_non_member_returns_404(method: str, path: str, monkeypatch: pytest.MonkeyPatch) -> None:
    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    monkeypatch.setattr(workspace_mentions, "require_workspace_access", deny_access)
    client = _mentions_client({"sub": "outsider", "role": "authenticated"})
    response = client.request(method, path, json={})
    assert response.status_code == 404
