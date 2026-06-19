from __future__ import annotations

import ast
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


HTTP_ROUTE_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}
TRUSTED_ROUTER_DIR = Path(__file__).resolve().parents[1] / "app" / "routers"


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    from app.settings import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _configure_app_env(monkeypatch: pytest.MonkeyPatch, *, origins: str = "https://app.omnix.test") -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://localhost:8001")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("DEV_MODE", "false")
    monkeypatch.setenv("OMNIX_APP_URL", "https://app.omnix.test")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", origins)

    from app.settings import get_settings

    get_settings.cache_clear()


def test_production_cors_uses_explicit_allowed_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_app_env(monkeypatch, origins="https://app.omnix.test,https://admin.omnix.test")

    from app.bootstrap.app import create_app

    client = TestClient(create_app())
    preflight_headers = {
        "Origin": "https://app.omnix.test",
        "Access-Control-Request-Method": "GET",
    }
    response = client.options("/health/live", headers=preflight_headers)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://app.omnix.test"

    blocked = client.options(
        "/health/live",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in blocked.headers


def test_production_cors_allows_project_frontend_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_app_env(monkeypatch, origins="")

    from app.bootstrap.app import create_app

    client = TestClient(create_app())
    response = client.options(
        "/files",
        headers={
            "Origin": "https://omni-x.co.in",
            "Access-Control-Request-Method": "GET",
        },
    )
    www_response = client.options(
        "/workspaces/hierarchy",
        headers={
            "Origin": "https://www.omni-x.co.in",
            "Access-Control-Request-Method": "GET",
        },
    )
    blocked = client.options(
        "/files",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://omni-x.co.in"
    assert www_response.status_code == 200
    assert www_response.headers["access-control-allow-origin"] == "https://www.omni-x.co.in"
    assert blocked.status_code == 400
    assert "access-control-allow-origin" not in blocked.headers


def test_detailed_health_and_admin_routes_require_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_app_env(monkeypatch)

    from app.bootstrap.app import create_app
    from app.core import security

    assert security._is_exempt_path("/health/live") is True
    assert security._is_exempt_path("/health/ready") is True
    assert security._is_exempt_path("/health/workers") is False

    client = TestClient(create_app())

    assert client.get("/health/live").status_code == 200
    health_response = client.get("/health/workers")
    admin_response = client.get("/admin/runtime/")

    assert health_response.status_code == 401
    assert admin_response.status_code == 401


@pytest.mark.asyncio
async def test_public_ingestion_worker_check_skips_trusted_stuck_job_scan(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.health import checks
    from app.jobs import queue

    fake_redis = AsyncMock()
    fake_redis.llen = AsyncMock(return_value=0)

    async def fail_count_stuck_jobs(minutes: int) -> int:
        raise AssertionError("public readiness must not call trusted stuck-job scan")

    monkeypatch.setattr(queue, "get_redis", lambda: fake_redis)
    monkeypatch.setattr(checks, "_count_stuck_jobs", fail_count_stuck_jobs)

    result = await checks.check_ingestion_worker(include_stuck_jobs=False)

    assert result["queue_depth"] == 0
    assert result["stuck_jobs"] == {
        "older_than_10m": None,
        "older_than_30m": None,
        "older_than_60m": None,
    }


@pytest.mark.asyncio
async def test_google_oauth_callback_rejects_unsigned_state_before_exchange(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.routers import google_drive

    async def fail_exchange(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError("token exchange must not run for unsigned state")

    monkeypatch.setattr(google_drive, "exchange_code_for_tokens", fail_exchange)

    with pytest.raises(HTTPException) as exc_info:
        await google_drive.oauth_callback(code="oauth-code", state="user-1|workspace-1")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid OAuth state"


@pytest.mark.asyncio
async def test_google_oauth_callback_accepts_signed_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.integrations import google_drive as drive_integration
    from app.routers import google_drive

    monkeypatch.setenv("GOOGLE_OAUTH_STATE_SECRET", "state-secret")
    monkeypatch.setenv("OMNIX_BASE_URL", "http://api.omnix.test")
    monkeypatch.setenv("OMNIX_FRONTEND_URL", "https://app.omnix.test")

    state = drive_integration.build_oauth_state("user-1", "workspace-1")
    captured: dict[str, Any] = {}

    async def fake_exchange(code: str, redirect_uri: str) -> dict[str, Any]:
        captured["exchange"] = {"code": code, "redirect_uri": redirect_uri}
        return {"access_token": "access-token", "refresh_token": "refresh-token"}

    async def fake_store(user_id: str, workspace_id: str | None, tokens: dict[str, Any]) -> dict[str, Any]:
        captured["store"] = {"user_id": user_id, "workspace_id": workspace_id, "tokens": tokens}
        return {"id": "token-row-1"}

    monkeypatch.setattr(google_drive, "exchange_code_for_tokens", fake_exchange)
    monkeypatch.setattr(google_drive, "store_token_for_user", fake_store)

    response = await google_drive.oauth_callback(code="oauth-code", state=state)

    assert response.status_code == 307
    assert captured["exchange"] == {
        "code": "oauth-code",
        "redirect_uri": "http://api.omnix.test/integrations/google_drive/callback",
    }
    assert captured["store"] == {
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "tokens": {"access_token": "access-token", "refresh_token": "refresh-token"},
    }


def _imports_trusted_helpers(tree: ast.Module) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").endswith("supabase_service"):
            if any(alias.name.endswith("_trusted") for alias in node.names):
                return True
    return False


def _is_route_handler(node: ast.AsyncFunctionDef | ast.FunctionDef) -> bool:
    for decorator in node.decorator_list:
        if not isinstance(decorator, ast.Call):
            continue
        func = decorator.func
        if isinstance(func, ast.Attribute) and func.attr in HTTP_ROUTE_METHODS:
            return True
    return False


def _has_current_user_dependency(node: ast.AsyncFunctionDef | ast.FunctionDef) -> bool:
    defaults = list(node.args.defaults) + [default for default in node.args.kw_defaults if default is not None]
    return any("Depends(get_current_user)" in ast.unparse(default) for default in defaults)


def test_router_trusted_helpers_are_only_exposed_from_authenticated_handlers() -> None:
    offenders: list[str] = []

    for path in sorted(TRUSTED_ROUTER_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        if not _imports_trusted_helpers(tree):
            continue

        for node in tree.body:
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and _is_route_handler(node):
                if not _has_current_user_dependency(node):
                    offenders.append(f"{path.name}:{node.lineno}:{node.name}")

    assert offenders == []
