from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


_TRUSTED_ORIGIN = "https://app.omnix.test"
_BROWSER_METHODS = {"GET", "POST", "PATCH", "DELETE"}
_BROWSER_HEADERS = {"authorization", "content-type", "x-omnix-workspace"}


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    from backend.app.settings import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _configure_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://localhost:8001")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("DEV_MODE", "false")
    monkeypatch.setenv("OMNIX_APP_URL", _TRUSTED_ORIGIN)
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", _TRUSTED_ORIGIN)
    monkeypatch.delenv("CORS_ALLOWED_ORIGIN_REGEX", raising=False)
    monkeypatch.delenv("OMNIX_FRONTEND_URL", raising=False)


def _header_tokens(response: object, header: str) -> set[str]:
    headers = getattr(response, "headers")
    return {value.strip().lower() for value in headers[header].split(",")}


def test_cors_preflight_matches_the_browser_api_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_production(monkeypatch)

    from backend.app.bootstrap.app import _cors_options, create_app

    assert _cors_options() == {
        "allow_origins": [_TRUSTED_ORIGIN, "https://omni-x.co.in", "https://www.omni-x.co.in"],
        "allow_origin_regex": None,
        "allow_credentials": False,
        "allow_methods": ["GET", "POST", "PATCH", "DELETE"],
        "allow_headers": ["Authorization", "Content-Type", "X-Omnix-Workspace"],
    }

    response = TestClient(create_app()).options(
        "/health/live",
        headers={
            "Origin": _TRUSTED_ORIGIN,
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "Authorization, Content-Type, X-Omnix-Workspace",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == _TRUSTED_ORIGIN
    assert "access-control-allow-credentials" not in response.headers
    assert _header_tokens(response, "access-control-allow-methods") == {method.lower() for method in _BROWSER_METHODS}
    assert _BROWSER_HEADERS <= _header_tokens(response, "access-control-allow-headers")


@pytest.mark.parametrize(
    ("requested_method", "requested_headers", "unexpected_token"),
    [
        ("PUT", "Authorization", "put"),
        ("PATCH", "Authorization, X-Untrusted-Header", "x-untrusted-header"),
    ],
)
def test_cors_preflight_rejects_methods_and_headers_outside_the_browser_contract(
    monkeypatch: pytest.MonkeyPatch,
    requested_method: str,
    requested_headers: str,
    unexpected_token: str,
) -> None:
    _configure_production(monkeypatch)

    from backend.app.bootstrap.app import create_app

    response = TestClient(create_app()).options(
        "/health/live",
        headers={
            "Origin": _TRUSTED_ORIGIN,
            "Access-Control-Request-Method": requested_method,
            "Access-Control-Request-Headers": requested_headers,
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-credentials" not in response.headers
    if requested_method == "PUT":
        assert unexpected_token not in _header_tokens(response, "access-control-allow-methods")
    else:
        assert unexpected_token not in _header_tokens(response, "access-control-allow-headers")
