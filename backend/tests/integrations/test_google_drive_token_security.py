from __future__ import annotations

from typing import Any

import pytest

from app.integrations import google_drive


@pytest.fixture(autouse=True)
def _token_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_TOKEN_ENCRYPTION_KEY", "test-token-encryption-secret")


@pytest.mark.asyncio
async def test_store_token_encrypts_access_and_refresh_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        captured["table"] = table
        captured["payload"] = payload
        return {"id": "token-row-1", **payload}

    monkeypatch.setattr(google_drive, "insert_one_trusted", fake_insert)

    row = await google_drive.store_token_for_user(
        "user-1",
        "workspace-1",
        {
            "access_token": "plain-access",
            "refresh_token": "plain-refresh",
            "scope": "drive.readonly",
            "expires_at": 12345,
        },
    )

    payload = captured["payload"]
    assert captured["table"] == "google_drive_tokens"
    assert payload["access_token"].startswith(google_drive.TOKEN_CIPHERTEXT_PREFIX)
    assert payload["refresh_token"].startswith(google_drive.TOKEN_CIPHERTEXT_PREFIX)
    assert "plain-access" not in payload["access_token"]
    assert "plain-refresh" not in payload["refresh_token"]
    assert row["access_token"] == payload["access_token"]


@pytest.mark.asyncio
async def test_get_token_decrypts_stored_ciphertext(monkeypatch: pytest.MonkeyPatch) -> None:
    encrypted_access = google_drive._encrypt_token("plain-access")
    encrypted_refresh = google_drive._encrypt_token("plain-refresh")
    captured_filters: dict[str, Any] = {}

    async def fake_select(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any]:
        captured_filters.update(filters)
        return {
            "id": "token-row-1",
            "user_id": "user-1",
            "workspace_id": "workspace-1",
            "access_token": encrypted_access,
            "refresh_token": encrypted_refresh,
            "expires_at": 12345,
            "scope": "drive.readonly",
        }

    monkeypatch.setattr(google_drive, "select_one_trusted", fake_select)

    row = await google_drive.get_token_for_user("user-1", "workspace-1")

    assert captured_filters == {"user_id": "user-1", "workspace_id": "workspace-1"}
    assert row is not None
    assert row["access_token"] == "plain-access"
    assert row["refresh_token"] == "plain-refresh"


@pytest.mark.asyncio
async def test_ensure_valid_token_persists_refreshed_access_token_encrypted(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_update: dict[str, Any] = {}

    async def fake_refresh(refresh_token: str) -> dict[str, Any]:
        assert refresh_token == "plain-refresh"
        return {"access_token": "new-access", "expires_at": 9999999999}

    async def fake_update(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        captured_update["table"] = table
        captured_update["filters"] = filters
        captured_update["payload"] = payload
        return {"id": filters["id"], **payload}

    monkeypatch.setattr(google_drive, "refresh_access_token", fake_refresh)
    monkeypatch.setattr(google_drive, "update_one_trusted", fake_update)

    row = await google_drive.ensure_valid_token(
        {
            "id": "token-row-1",
            "access_token": google_drive._encrypt_token("old-access"),
            "refresh_token": google_drive._encrypt_token("plain-refresh"),
            "expires_at": 1,
        }
    )

    payload = captured_update["payload"]
    assert captured_update["table"] == "google_drive_tokens"
    assert captured_update["filters"] == {"id": "token-row-1"}
    assert payload["access_token"].startswith(google_drive.TOKEN_CIPHERTEXT_PREFIX)
    assert "new-access" not in payload["access_token"]
    assert row["access_token"] == "new-access"

