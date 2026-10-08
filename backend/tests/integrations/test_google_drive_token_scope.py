from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.integrations import google_drive
from app.routers import google_drive as drive_router
from app.services import supabase_service


class TokenQuery:
    """In-memory transport; exercise the real trusted lookup and filter adapter."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def table(self, name: str) -> TokenQuery:
        assert name == "google_drive_tokens"
        return self

    def select(self, columns: str) -> TokenQuery:
        assert "access_token" in columns
        return self

    def eq(self, column: str, value: Any) -> TokenQuery:
        self.rows = [row for row in self.rows if row.get(column) == value]
        return self

    def is_(self, column: str, value: Any) -> TokenQuery:
        assert value is None
        self.rows = [row for row in self.rows if row.get(column) is None]
        return self

    def limit(self, count: int) -> TokenQuery:
        self.rows = self.rows[:count]
        return self

    def maybe_single(self) -> TokenQuery:
        return self

    async def execute(self) -> SimpleNamespace:
        return SimpleNamespace(data=self.rows[0] if self.rows else None)


@pytest.fixture
def token_rows(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    monkeypatch.setenv("OMNIX_TOKEN_ENCRYPTION_KEY", "scope-test-key")
    rows = [
        {
            "id": token_id,
            "user_id": user_id,
            "workspace_id": workspace_id,
            "access_token": google_drive._encrypt_token(f"{token_id}-access"),
            "refresh_token": google_drive._encrypt_token(f"{token_id}-refresh"),
        }
        for token_id, user_id, workspace_id in [
            ("other-personal", "other-user", None),
            ("workspace-b", "user-1", "workspace-b"),
            ("workspace-a", "user-1", "workspace-a"),
            ("personal", "user-1", None),
        ]
    ]
    monkeypatch.setattr(
        supabase_service,
        "_async_client",
        AsyncMock(side_effect=lambda: TokenQuery(list(rows))),
    )
    return rows


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("workspace_id", "expected_id"),
    [
        (None, "personal"),
        ("workspace-a", "workspace-a"),
        ("workspace-b", "workspace-b"),
        ("missing", None),
    ],
)
async def test_token_lookup_is_exactly_scoped_and_decrypts(
    token_rows: list[dict[str, Any]], workspace_id: str | None, expected_id: str | None
) -> None:
    row = await google_drive.get_token_for_user("user-1", workspace_id)
    if expected_id is None:
        assert row is None
    else:
        assert row is not None
        assert row["id"] == expected_id
        assert row["access_token"] == f"{expected_id}-access"
        assert row["refresh_token"] == f"{expected_id}-refresh"
    assert all(
        row["access_token"].startswith(google_drive.TOKEN_CIPHERTEXT_PREFIX)
        for row in token_rows
    )


@pytest.mark.asyncio
async def test_missing_personal_token_does_not_fall_back_to_workspace_or_other_user(
    token_rows: list[dict[str, Any]],
) -> None:
    token_rows[:] = [row for row in token_rows if row["id"] != "personal"]
    assert await google_drive.get_token_for_user("user-1") is None


@pytest.mark.parametrize("has_personal_token", [False, True])
def test_personal_files_route_never_uses_workspace_credentials(
    monkeypatch: pytest.MonkeyPatch,
    token_rows: list[dict[str, Any]],
    has_personal_token: bool,
) -> None:
    if not has_personal_token:
        token_rows[:] = [row for row in token_rows if row["id"] != "personal"]
    list_files = AsyncMock(return_value={"files": []})
    require_access = AsyncMock()
    monkeypatch.setattr(drive_router, "list_drive_files_for_user", list_files)
    monkeypatch.setattr(drive_router, "require_workspace_access", require_access)
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-1"}
    app.include_router(drive_router.router)
    with TestClient(app) as client:
        response = client.get("/integrations/google_drive/files")
    require_access.assert_not_awaited()
    if has_personal_token:
        assert response.status_code == 200
        assert list_files.await_args.args[0]["id"] == "personal"
        assert list_files.await_args.args[0]["access_token"] == "personal-access"
    else:
        assert response.status_code == 404
        list_files.assert_not_awaited()
