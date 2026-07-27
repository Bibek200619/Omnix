from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_TRUSTED_ORIGIN = "https://app.omnix.test"


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    from backend.app.settings import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _configure_app_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://localhost:8001")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("DEV_MODE", "false")
    monkeypatch.setenv("OMNIX_APP_URL", _TRUSTED_ORIGIN)
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", _TRUSTED_ORIGIN)


def _client(monkeypatch: pytest.MonkeyPatch, *, base_url: str) -> TestClient:
    _configure_app_env(monkeypatch)

    from backend.app.bootstrap.app import create_app

    return TestClient(create_app(), base_url=base_url)


def test_api_responses_have_the_browser_security_baseline(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _client(monkeypatch, base_url="http://api.omnix.test").get("/health/live")

    assert response.status_code == 200
    assert response.headers["content-security-policy"] == (
        "default-src 'none'; base-uri 'none'; form-action 'none'; "
        "frame-ancestors 'none'; object-src 'none'"
    )
    assert response.headers["permissions-policy"] == (
        "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), "
        "microphone=(), payment=(), usb=()"
    )
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "strict-transport-security" not in response.headers


def test_https_api_responses_enable_host_scoped_hsts(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _client(monkeypatch, base_url="https://api.omnix.test").get("/health/live")

    assert response.status_code == 200
    assert response.headers["strict-transport-security"] == "max-age=31536000"


def test_docs_csp_keeps_fastapi_docs_assets_compatible(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _client(monkeypatch, base_url="https://api.omnix.test").get("/docs")

    assert response.status_code == 200
    policy = response.headers["content-security-policy"]
    assert "https://cdn.jsdelivr.net" in policy
    assert "script-src 'self' 'unsafe-inline'" in policy
    assert "style-src 'self' 'unsafe-inline'" in policy
    assert "frame-ancestors 'none'" in policy


def test_nginx_declares_the_same_browser_security_header_baseline() -> None:
    nginx_config = (_PROJECT_ROOT / "nginx.conf").read_text(encoding="utf-8")

    for header in (
        "Content-Security-Policy",
        "Permissions-Policy",
        "Strict-Transport-Security",
        'X-Frame-Options "DENY"',
        'X-Content-Type-Options "nosniff"',
        'Referrer-Policy "strict-origin-when-cross-origin"',
    ):
        assert header in nginx_config
