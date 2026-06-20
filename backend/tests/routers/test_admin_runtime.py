from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import admin_auth
from app.routers import admin


ADMIN_ENDPOINTS = (
    "/admin/runtime/",
    "/admin/runtime/workers",
    "/admin/runtime/providers",
    "/admin/runtime/settings",
)


def _admin_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    if current_user is not None:
        app.dependency_overrides[admin_auth.get_current_user] = lambda: current_user
    app.include_router(admin.router)
    return TestClient(app)


@pytest.mark.parametrize("endpoint", ADMIN_ENDPOINTS)
def test_runtime_admin_endpoint_rejects_unauthenticated_users(endpoint: str) -> None:
    client = _admin_client()

    response = client.get(endpoint)

    assert response.status_code == 401


@pytest.mark.parametrize("endpoint", ADMIN_ENDPOINTS)
def test_runtime_admin_endpoint_rejects_normal_authenticated_users(
    endpoint: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_select_all_trusted(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(admin_auth, "select_all_trusted", fake_select_all_trusted)
    client = _admin_client({"sub": "member-1", "role": "authenticated"})

    response = client.get(endpoint)

    assert response.status_code == 403
    assert response.json()["detail"] == "Runtime admin access is required."


@pytest.mark.parametrize(
    "current_user",
    [
        {"sub": "admin-1", "role": "authenticated", "app_metadata": {"role": "admin"}},
        {"sub": "owner-1", "role": "authenticated", "user_metadata": {"roles": ["owner"]}},
    ],
)
@pytest.mark.parametrize("endpoint", ADMIN_ENDPOINTS)
def test_runtime_admin_endpoint_allows_elevated_claim_roles(
    endpoint: str,
    current_user: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_if_membership_checked(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError("claim-authorized users should not need membership lookup")

    monkeypatch.setattr(admin_auth, "select_all_trusted", fail_if_membership_checked)
    client = _admin_client(current_user)

    response = client.get(endpoint)

    assert response.status_code == 200


@pytest.mark.parametrize("role", ["founder", "owner", "super_founder"])
@pytest.mark.parametrize("endpoint", ADMIN_ENDPOINTS)
def test_runtime_admin_endpoint_allows_workspace_founder_owner_memberships(
    endpoint: str,
    role: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        captured.update({"table": table, "columns": columns, "filters": filters, **kwargs})
        return [{"workspace_id": "workspace-1", "user_id": filters["user_id"], "role": role}]

    monkeypatch.setattr(admin_auth, "select_all_trusted", fake_select_all_trusted)
    client = _admin_client({"sub": "founder-1", "role": "authenticated"})

    response = client.get(endpoint)

    assert response.status_code == 200
    assert captured["table"] == "workspace_members"
    assert captured["filters"]["user_id"] == "founder-1"
    assert set(captured["filters"]["role"]) == {"founder", "owner", "super_founder"}
