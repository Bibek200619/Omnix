from __future__ import annotations

import pytest

from app.integrations import google_drive


def test_google_drive_token_helpers_encrypt_and_decrypt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_TOKEN_ENCRYPTION_KEY", "unit-test-secret")

    encrypted = google_drive._encrypt_token_value("access-secret")

    assert encrypted != "access-secret"
    assert encrypted.startswith(google_drive.ENCRYPTED_TOKEN_PREFIX)
    assert google_drive._decrypt_token_value(encrypted) == "access-secret"
    assert google_drive._decrypt_token_value("legacy-plaintext") == "legacy-plaintext"


@pytest.mark.asyncio
async def test_store_token_for_user_encrypts_token_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_TOKEN_ENCRYPTION_KEY", "unit-test-secret")
    captured: dict[str, object] = {}

    async def fake_insert_one_trusted(table: str, payload: dict[str, object]) -> dict[str, object]:
        captured["table"] = table
        captured["payload"] = payload
        return {"id": "token-row-1", **payload}

    monkeypatch.setattr(google_drive, "insert_one_trusted", fake_insert_one_trusted)

    row = await google_drive.store_token_for_user(
        "user-1",
        "workspace-1",
        {
            "access_token": "access-secret",
            "refresh_token": "refresh-secret",
            "scope": "drive.readonly",
            "expires_at": 123,
        },
    )

    payload = captured["payload"]
    assert captured["table"] == "google_drive_tokens"
    assert payload["access_token"] != "access-secret"
    assert payload["refresh_token"] != "refresh-secret"
    assert google_drive._decrypt_token_value(payload["access_token"]) == "access-secret"
    assert google_drive._decrypt_token_value(payload["refresh_token"]) == "refresh-secret"
    assert row["access_token"] == payload["access_token"]


@pytest.mark.asyncio
async def test_ensure_valid_token_decrypts_unexpired_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_TOKEN_ENCRYPTION_KEY", "unit-test-secret")
    encrypted_access = google_drive._encrypt_token_value("access-secret")
    encrypted_refresh = google_drive._encrypt_token_value("refresh-secret")

    row = await google_drive.ensure_valid_token(
        {
            "id": "token-row-1",
            "access_token": encrypted_access,
            "refresh_token": encrypted_refresh,
            "expires_at": int(google_drive.time.time()) + 3600,
        }
    )

    assert row["access_token"] == "access-secret"
    assert row["refresh_token"] == "refresh-secret"
