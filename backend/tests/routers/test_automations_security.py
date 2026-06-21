from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.routers import automations
from app.services.workspace_service import WorkspaceAccess


def _client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    if current_user is not None:
        app.dependency_overrides[get_current_user] = lambda: current_user
    app.include_router(automations.router)
    return TestClient(app, raise_server_exceptions=False)


# ---- Unauthenticated ----


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/workspaces/ws-1/automations"),
        ("POST", "/workspaces/ws-1/automations"),
        ("POST", "/workspaces/ws-1/automations/auto-1/run"),
        ("PATCH", "/workspaces/ws-1/automations/auto-1"),
    ],
)
def test_unauthenticated_returns_401(method: str, path: str) -> None:
    client = _client()
    response = client.request(method, path, json={})
    assert response.status_code == 401


# ---- Authenticated, not workspace member ----


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/workspaces/ws-1/automations"),
        ("POST", "/workspaces/ws-1/automations"),
        ("POST", "/workspaces/ws-1/automations/auto-1/run"),
        ("PATCH", "/workspaces/ws-1/automations/auto-1"),
    ],
)
def test_non_member_returns_404(method: str, path: str, monkeypatch: pytest.MonkeyPatch) -> None:
    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    monkeypatch.setattr(automations, "require_workspace_access", deny_access)
    client = _client({"sub": "outsider", "role": "authenticated"})
    response = client.request(method, path, json={})
    assert response.status_code == 404


# ---- Authenticated workspace member ----


def test_member_list_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_access = WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-1"}, role="member")

    async def allow_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return mock_access

    async def fake_select(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(automations, "require_workspace_access", allow_access)
    monkeypatch.setattr(automations, "select_all_trusted", fake_select)
    client = _client({"sub": "user-1", "role": "authenticated"})
    response = client.get("/workspaces/ws-1/automations")
    assert response.status_code == 200


def test_member_create_returns_201(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_access = WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-1"}, role="member")

    async def allow_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return mock_access

    async def fake_insert(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"id": "new-auto", "workspace_id": "ws-1"}

    monkeypatch.setattr(automations, "require_workspace_access", allow_access)
    monkeypatch.setattr(automations, "insert_one_trusted", fake_insert)
    client = _client({"sub": "user-1", "role": "authenticated"})
    response = client.post(
        "/workspaces/ws-1/automations",
        json={"name": "test", "job_type": "daily_summary"},
    )
    assert response.status_code == 201
