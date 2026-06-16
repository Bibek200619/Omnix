from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.routers import admin


@pytest.mark.asyncio
async def test_admin_dependency_rejects_regular_authenticated_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OMNIX_ADMIN_USER_IDS", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        await admin.require_admin_user({"sub": "user-1", "role": "authenticated"})

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_dependency_allows_configured_admin_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_ADMIN_USER_IDS", "admin-1")
    current_user = {"sub": "admin-1", "role": "authenticated"}

    assert await admin.require_admin_user(current_user) is current_user


@pytest.mark.asyncio
async def test_admin_dependency_allows_admin_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OMNIX_ADMIN_USER_IDS", raising=False)
    current_user = {
        "sub": "user-1",
        "role": "authenticated",
        "app_metadata": {"roles": ["admin"]},
    }

    assert await admin.require_admin_user(current_user) is current_user


def test_admin_router_has_router_level_dependency() -> None:
    assert any(
        dependency.dependency is admin.require_admin_user
        for dependency in admin.router.dependencies
    )
