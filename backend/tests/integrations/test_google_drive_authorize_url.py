from __future__ import annotations

from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.integrations import google_drive
from app.routers import google_drive as drive_router


@pytest.fixture
def oauth_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "GOOGLE_OAUTH_CLIENT_ID", "test-client+id&日本語.apps.googleusercontent.com"
    )
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret-never-in-url")
    monkeypatch.setenv("GOOGLE_OAUTH_STATE_SECRET", "test-state-signing-key")
    monkeypatch.setenv("OMNIX_BASE_URL", "https://api.example.test/")


@pytest.mark.parametrize(
    "state", [None, "signed+state/=with&reserved?#characters", "日本語 state"]
)
def test_authorize_url_round_trips_all_query_values(
    oauth_environment: None, state: str | None
) -> None:
    redirect_uri = (
        "https://api.example.test/callback?next=/files&label=日本語+#fragment"
    )
    url = google_drive.build_oauth_authorize_url(redirect_uri, state)
    parsed = urlsplit(url)
    assert (
        f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        == google_drive.GOOGLE_OAUTH_AUTHORIZE
    )
    assert parsed.fragment == ""
    params = parse_qs(parsed.query, strict_parsing=True)
    expected = {
        "response_type": ["code"],
        "client_id": ["test-client+id&日本語.apps.googleusercontent.com"],
        "redirect_uri": [redirect_uri],
        "scope": [" ".join(google_drive.SCOPES)],
        "access_type": ["offline"],
        "prompt": ["consent"],
    }
    if state:
        expected["state"] = [state]
    assert params == expected
    assert "test-client-secret-never-in-url" not in url


@pytest.mark.parametrize("workspace_id", [None, "workspace-a"])
def test_authenticated_connect_uses_real_url_builder_and_signed_state(
    oauth_environment: None, monkeypatch: pytest.MonkeyPatch, workspace_id: str | None
) -> None:
    require_access = AsyncMock()
    monkeypatch.setattr(drive_router, "require_workspace_access", require_access)
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-1"}
    app.include_router(drive_router.router)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get(
            "/integrations/google_drive/connect",
            params={"workspace_id": workspace_id} if workspace_id else {},
        )
    assert response.status_code == 200
    query = parse_qs(urlsplit(response.json()["authorize_url"]).query)
    assert query["redirect_uri"] == [
        "https://api.example.test/integrations/google_drive/callback"
    ]
    assert google_drive.parse_oauth_state(query["state"][0]) == ("user-1", workspace_id)
    if workspace_id:
        require_access.assert_awaited_once_with(workspace_id, "user-1")
    else:
        require_access.assert_not_awaited()


def test_denied_workspace_stops_before_url_or_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        drive_router,
        "require_workspace_access",
        AsyncMock(side_effect=HTTPException(404, "Workspace not found.")),
    )

    def forbidden_credentials() -> tuple[str, str]:
        raise AssertionError("Denied connect must not build the URL")

    monkeypatch.setattr(google_drive, "_client_credentials", forbidden_credentials)
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "outsider"}
    app.include_router(drive_router.router)
    with TestClient(app) as client:
        response = client.get(
            "/integrations/google_drive/connect", params={"workspace_id": "workspace-a"}
        )
    assert response.status_code == 404


def test_missing_credentials_still_fail_explicitly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="not configured"):
        google_drive.build_oauth_authorize_url("https://api.example.test/callback")
