from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.routers import google_drive
from app.services.workspace_service import WorkspaceAccess


def _client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    if current_user is not None:
        app.dependency_overrides[get_current_user] = lambda: current_user
    app.include_router(google_drive.router)
    return TestClient(app, raise_server_exceptions=False)


# ---- connect_google_drive: non-member ----


def test_connect_non_member_returns_404(monkeypatch: pytest.MonkeyPatch) -> None:
    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    monkeypatch.setattr(google_drive, "require_workspace_access", deny_access)
    client = _client({"sub": "outsider", "role": "authenticated"})
    response = client.get("/integrations/google_drive/connect?workspace_id=ws-1")
    assert response.status_code == 404


def test_connect_member_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_access = WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-1"}, role="member")

    async def allow_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return mock_access

    monkeypatch.setattr(google_drive, "require_workspace_access", allow_access)
    monkeypatch.setattr(google_drive, "build_oauth_state", lambda *a: "state")
    monkeypatch.setattr(google_drive, "build_oauth_authorize_url", lambda *a, **kw: "https://accounts.google.com/o/oauth2/auth")
    client = _client({"sub": "user-1", "role": "authenticated"})
    response = client.get("/integrations/google_drive/connect?workspace_id=ws-1")
    assert response.status_code == 200


# ---- import_file: non-member ----


def test_import_non_member_returns_404(monkeypatch: pytest.MonkeyPatch) -> None:
    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    monkeypatch.setattr(google_drive, "require_workspace_access", deny_access)
    client = _client({"sub": "outsider", "role": "authenticated"})
    response = client.post("/integrations/google_drive/import?workspace_id=ws-1&file_id=abc")
    assert response.status_code == 404


# ---- oauth_callback: non-member workspace ----


def test_oauth_callback_non_member_redirects_with_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(google_drive, "parse_oauth_state", lambda s: ("user-1", "ws-1"))

    async def fake_exchange(*a: Any, **kw: Any) -> dict[str, Any]:
        return {"access_token": "token", "refresh_token": "refresh"}

    monkeypatch.setattr(google_drive, "exchange_code_for_tokens", fake_exchange)

    async def fake_store(*a: Any, **kw: Any) -> None:
        pass

    monkeypatch.setattr(google_drive, "store_token_for_user", fake_store)

    async def deny_resolve(workspace_id: str, user_id: str) -> None:
        return None

    monkeypatch.setattr(google_drive, "resolve_workspace_access", deny_resolve)

    client = _client()  # oauth_callback is auth-exempt
    response = client.get("/integrations/google_drive/callback?code=test_code&state=test_state", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers.get("location", "")
    assert "workspace_access_denied" in location or "error" in location
