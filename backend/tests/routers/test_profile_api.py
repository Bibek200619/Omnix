from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.main import app as production_app
from app.routers import profile
from app.services import profile_service


def _missing_column_error(column: str) -> profile_service.SupabaseServiceError:
    exc = profile_service.SupabaseServiceError("Internal server error")
    exc.__cause__ = RuntimeError(
        f"Could not find the '{column}' column of 'profiles' in the schema cache"
    )
    return exc


def _profile_row(**overrides: Any) -> dict[str, Any]:
    row = {
        "user_id": "user-1",
        "email": "alex@example.com",
        "username": "alex-dev",
        "display_name": "Alex Dev",
        "avatar_url": "https://example.com/avatar.png",
        "created_at": None,
        "updated_at": None,
    }
    row.update(overrides)
    return row


def _profile_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    app.dependency_overrides[profile.get_current_user] = lambda: current_user or {
        "sub": "user-1",
        "email": "alex@example.com",
    }
    app.include_router(profile.router)
    return TestClient(app)


def test_profile_route_is_registered_on_production_app() -> None:
    client = TestClient(production_app)

    response = client.get("/profile")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authentication token."


def test_get_profile_returns_authenticated_user_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_ensure_user_profile(current_user: dict[str, Any]) -> dict[str, Any]:
        assert current_user["sub"] == "user-1"
        return _profile_row()

    monkeypatch.setattr(profile, "ensure_user_profile", fake_ensure_user_profile)
    client = _profile_client()

    response = client.get("/profile")

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == "user-1"
    assert body["username"] == "alex-dev"
    assert body["display_name"] == "Alex Dev"


def test_patch_profile_updates_display_name_username_and_avatar(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payload: dict[str, Any] = {}

    async def fake_update_user_profile(
        current_user: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        assert current_user["sub"] == "user-1"
        captured_payload.update(payload)
        return _profile_row(
            username=payload["username"],
            display_name=payload["display_name"],
            avatar_url=payload["avatar_url"],
        )

    monkeypatch.setattr(profile, "update_user_profile", fake_update_user_profile)
    client = _profile_client()

    response = client.patch(
        "/profile",
        json={
            "display_name": "Alex Morgan",
            "username": "alex-morgan",
            "avatar_url": "https://example.com/new-avatar.png",
        },
    )

    assert response.status_code == 200
    assert captured_payload == {
        "display_name": "Alex Morgan",
        "username": "alex-morgan",
        "avatar_url": "https://example.com/new-avatar.png",
    }
    body = response.json()
    assert body["display_name"] == "Alex Morgan"
    assert body["username"] == "alex-morgan"
    assert body["avatar_url"] == "https://example.com/new-avatar.png"


def test_patch_profile_rejects_unknown_profile_fields() -> None:
    client = _profile_client()

    response = client.patch("/profile", json={"role": "owner"})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_user_profile_maps_api_fields_to_profile_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    selected_filters: list[dict[str, Any]] = []
    update_payloads: list[dict[str, Any]] = []

    async def fake_select_one_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        assert table == "profiles"
        assert columns == "id,name,username,avatar_url,created_at,updated_at"
        selected_filters.append(filters)
        if "id" in filters:
            return {
                "id": "user-1",
                "username": None,
                "name": None,
                "avatar_url": None,
                "created_at": None,
                "updated_at": None,
            }
        return None

    async def fake_update_one_trusted(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "profiles"
        assert filters == {"id": "user-1"}
        update_payloads.append(payload)
        return {
            "id": "user-1",
            "username": payload["username"],
            "name": payload["name"],
            "avatar_url": payload["avatar_url"],
            "created_at": None,
            "updated_at": payload["updated_at"],
        }

    monkeypatch.setattr(profile_service, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(profile_service, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(profile_service, "utc_now_iso", lambda: "2026-05-18T00:00:00+00:00")

    response = await profile_service.update_user_profile(
        {"sub": "user-1", "email": "Alex@Example.com"},
        {
            "display_name": "Alex Morgan",
            "username": "Alex-Morgan",
            "avatar_url": "https://example.com/avatar.png",
        },
    )

    assert selected_filters[-1] == {"username": "alex-morgan"}
    assert update_payloads == [
        {
            "updated_at": "2026-05-18T00:00:00+00:00",
            "name": "Alex Morgan",
            "avatar_url": "https://example.com/avatar.png",
            "username": "alex-morgan",
        }
    ]
    assert response["user_id"] == "user-1"
    assert response["display_name"] == "Alex Morgan"
    assert response["username"] == "alex-morgan"


@pytest.mark.asyncio
async def test_update_user_profile_retries_without_updated_at_when_schema_is_behind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    update_payloads: list[dict[str, Any]] = []

    async def fake_select_one_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        assert table == "profiles"
        return {
            "id": "user-1",
            "username": "alex-dev",
            "name": "Alex Dev",
            "avatar_url": None,
            "created_at": None,
            "updated_at": None,
        }

    async def fake_update_one_trusted(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "profiles"
        assert filters == {"id": "user-1"}
        update_payloads.append(payload)
        if "updated_at" in payload:
            raise _missing_column_error("updated_at")
        return {
            "id": "user-1",
            "username": "alex-dev",
            "name": payload["name"],
            "avatar_url": None,
            "created_at": None,
        }

    monkeypatch.setattr(profile_service, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(profile_service, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(profile_service, "utc_now_iso", lambda: "2026-05-18T00:00:00+00:00")

    response = await profile_service.update_user_profile(
        {"sub": "user-1", "email": "alex@example.com"},
        {"display_name": "Alex Morgan"},
    )

    assert update_payloads == [
        {
            "updated_at": "2026-05-18T00:00:00+00:00",
            "name": "Alex Morgan",
        },
        {"name": "Alex Morgan"},
    ]
    assert response["display_name"] == "Alex Morgan"
    assert response["username"] == "alex-dev"


@pytest.mark.asyncio
async def test_ensure_user_profile_retries_insert_without_timestamps_when_schema_is_behind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inserted_payloads: list[dict[str, Any]] = []

    async def fake_select_one_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        assert table == "profiles"
        assert filters == {"id": "user-1"}
        return None

    async def fake_insert_one_trusted(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "profiles"
        inserted_payloads.append(payload)
        if "updated_at" in payload:
            raise _missing_column_error("updated_at")
        return {
            "id": payload["id"],
            "username": payload["username"],
            "name": payload["name"],
            "avatar_url": payload["avatar_url"],
        }

    monkeypatch.setattr(profile_service, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(profile_service, "insert_one_trusted", fake_insert_one_trusted)
    monkeypatch.setattr(profile_service, "utc_now_iso", lambda: "2026-05-18T00:00:00+00:00")

    response = await profile_service.ensure_user_profile(
        {
            "sub": "user-1",
            "email": "Alex@Example.com",
            "user_metadata": {"full_name": "Alex Dev", "username": "alex-dev"},
        },
    )

    assert inserted_payloads == [
        {
            "id": "user-1",
            "username": "alex-dev",
            "name": "Alex Dev",
            "avatar_url": None,
            "created_at": "2026-05-18T00:00:00+00:00",
            "updated_at": "2026-05-18T00:00:00+00:00",
        },
        {
            "id": "user-1",
            "username": "alex-dev",
            "name": "Alex Dev",
            "avatar_url": None,
        },
    ]
    assert response["user_id"] == "user-1"
    assert response["display_name"] == "Alex Dev"
    assert response["username"] == "alex-dev"


@pytest.mark.asyncio
async def test_update_user_profile_rejects_existing_username_change(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select_one_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        assert table == "profiles"
        assert filters == {"id": "user-1"}
        return {
            "id": "user-1",
            "username": "alex-dev",
            "name": "Alex Dev",
            "avatar_url": None,
            "created_at": None,
            "updated_at": None,
        }

    monkeypatch.setattr(profile_service, "select_one_trusted", fake_select_one_trusted)

    with pytest.raises(HTTPException) as exc_info:
        await profile_service.update_user_profile(
            {"sub": "user-1", "email": "alex@example.com"},
            {"username": "other-dev"},
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Username is already set and cannot be changed."
