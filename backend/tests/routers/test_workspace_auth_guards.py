from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import actions, automations, google_drive


class DummyRequest:
    def __init__(self, headers: dict[str, str] | None = None) -> None:
        self.headers = headers or {}
        self.state = SimpleNamespace(user={"sub": "user-1"})


async def _deny_access(workspace_id: str, user_id: str) -> None:
    raise HTTPException(status_code=404, detail="Workspace not found.")


@pytest.mark.asyncio
async def test_automations_require_workspace_access_before_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail_select(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        pytest.fail("automation rows should not be read before workspace access is verified")

    monkeypatch.setattr(automations, "require_workspace_access", _deny_access)
    monkeypatch.setattr(automations, "select_all_trusted", fail_select)

    with pytest.raises(HTTPException) as exc_info:
        await automations.list_automations("workspace-2", current_user={"sub": "user-1"})

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_automation_update_is_workspace_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def allow_access(workspace_id: str, user_id: str) -> object:
        return object()

    async def fake_update(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        captured["table"] = table
        captured["filters"] = filters
        captured["payload"] = payload
        return {"id": filters["id"], "workspace_id": filters["workspace_id"], **payload}

    monkeypatch.setattr(automations, "require_workspace_access", allow_access)
    monkeypatch.setattr(automations, "update_one_trusted", fake_update)

    updated = await automations.update_automation(
        "workspace-1",
        "automation-1",
        {"name": "Nightly", "enabled": "yes", "workspace_id": "workspace-2", "user_id": "user-2"},
        current_user={"sub": "user-1"},
    )

    assert captured["table"] == "automations"
    assert captured["filters"] == {"id": "automation-1", "workspace_id": "workspace-1"}
    assert captured["payload"] == {"name": "Nightly", "enabled": True}
    assert updated["workspace_id"] == "workspace-1"


@pytest.mark.asyncio
async def test_actions_require_workspace_access_before_context_work(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_vector_store() -> object:
        pytest.fail("context retrieval should not start before workspace access is verified")

    monkeypatch.setattr(actions, "require_workspace_access", _deny_access)
    monkeypatch.setattr(actions, "get_vector_store", fail_vector_store)

    with pytest.raises(HTTPException) as exc_info:
        await actions.run_action(
            DummyRequest({"X-Omnix-Workspace": "workspace-2"}),
            actions.ActionRequest(action="summarize"),
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_google_drive_connect_requires_workspace_access(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_build_url(*args: Any, **kwargs: Any) -> str:
        pytest.fail("OAuth URL should not be built before workspace access is verified")

    monkeypatch.setattr(google_drive, "require_workspace_access", _deny_access)
    monkeypatch.setattr(google_drive, "build_oauth_authorize_url", fail_build_url)

    with pytest.raises(HTTPException) as exc_info:
        await google_drive.connect_google_drive(
            DummyRequest(),
            workspace_id="workspace-2",
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_google_drive_callback_rejects_tampered_state_before_exchange(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail_exchange(*args: Any, **kwargs: Any) -> dict[str, Any]:
        pytest.fail("OAuth code exchange should not run with tampered state")

    monkeypatch.setenv("GOOGLE_OAUTH_STATE_SECRET", "test-secret")
    monkeypatch.setattr(google_drive, "exchange_code_for_tokens", fail_exchange)
    state = google_drive._sign_oauth_state("user-1", "workspace-1")

    with pytest.raises(HTTPException) as exc_info:
        await google_drive.oauth_callback(code="oauth-code", state=f"{state}x")

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_google_drive_callback_rechecks_workspace_access_before_exchange(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail_exchange(*args: Any, **kwargs: Any) -> dict[str, Any]:
        pytest.fail("OAuth code exchange should not run before callback workspace access is verified")

    monkeypatch.setenv("GOOGLE_OAUTH_STATE_SECRET", "test-secret")
    monkeypatch.setattr(google_drive, "require_workspace_access", _deny_access)
    monkeypatch.setattr(google_drive, "exchange_code_for_tokens", fail_exchange)
    state = google_drive._sign_oauth_state("user-1", "workspace-2")

    with pytest.raises(HTTPException) as exc_info:
        await google_drive.oauth_callback(code="oauth-code", state=state)

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_google_drive_list_requires_workspace_access_before_token_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail_token_lookup(*args: Any, **kwargs: Any) -> dict[str, Any] | None:
        pytest.fail("Drive token lookup should not run before workspace access is verified")

    monkeypatch.setattr(google_drive, "require_workspace_access", _deny_access)
    monkeypatch.setattr(google_drive, "get_token_for_user", fail_token_lookup)

    with pytest.raises(HTTPException) as exc_info:
        await google_drive.list_files(workspace_id="workspace-2", current_user={"sub": "user-1"})

    assert exc_info.value.status_code == 404
