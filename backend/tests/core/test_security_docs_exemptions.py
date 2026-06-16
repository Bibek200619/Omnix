from __future__ import annotations

from app.core import security


def test_docs_paths_are_exempt_only_when_public_docs_enabled(monkeypatch) -> None:
    monkeypatch.setattr(security, "public_api_docs_enabled", lambda: False)
    assert security._is_exempt_path("/docs") is False
    assert security._is_exempt_path("/openapi.json") is False

    monkeypatch.setattr(security, "public_api_docs_enabled", lambda: True)
    assert security._is_exempt_path("/docs") is True
    assert security._is_exempt_path("/openapi.json") is True


def test_health_and_google_callback_remain_auth_exempt(monkeypatch) -> None:
    monkeypatch.setattr(security, "public_api_docs_enabled", lambda: False)

    assert security._is_exempt_path("/health/live") is True
    assert security._is_exempt_path("/integrations/google_drive/callback") is True
