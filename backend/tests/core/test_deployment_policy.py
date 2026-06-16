from __future__ import annotations

from types import SimpleNamespace

from app.core import deployment


def _settings(**overrides):
    values = {
        "ENV": "prod",
        "DEV_MODE": False,
        "OMNIX_PUBLIC_API_DOCS": None,
        "OMNIX_CORS_ALLOWED_ORIGINS": "",
        "OMNIX_APP_URL": "https://app.omni-x.co.in",
        "OMNIX_ADMIN_USER_IDS": "",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_public_docs_default_to_dev_only() -> None:
    assert deployment.public_api_docs_enabled(_settings(ENV="dev", DEV_MODE=True)) is True
    assert deployment.public_api_docs_enabled(_settings(ENV="prod", DEV_MODE=False)) is False


def test_public_docs_can_be_explicitly_enabled() -> None:
    assert deployment.public_api_docs_enabled(_settings(OMNIX_PUBLIC_API_DOCS=True)) is True


def test_cors_uses_wildcard_only_for_dev_without_credentials() -> None:
    origins = deployment.cors_allowed_origins(
        _settings(ENV="dev", DEV_MODE=True, OMNIX_APP_URL="")
    )

    assert origins == ["*"]
    assert deployment.cors_allow_credentials(origins) is False


def test_cors_rejects_production_wildcard_and_falls_back_to_app_url(monkeypatch) -> None:
    monkeypatch.delenv("OMNIX_CORS_ALLOWED_ORIGINS", raising=False)
    origins = deployment.cors_allowed_origins(
        _settings(OMNIX_CORS_ALLOWED_ORIGINS="*", OMNIX_APP_URL="https://app.omni-x.co.in")
    )

    assert origins == ["https://app.omni-x.co.in"]
    assert deployment.cors_allow_credentials(origins) is True


def test_cors_uses_known_omnix_origins_when_production_env_is_incomplete(monkeypatch) -> None:
    monkeypatch.delenv("OMNIX_CORS_ALLOWED_ORIGINS", raising=False)
    origins = deployment.cors_allowed_origins(_settings(OMNIX_APP_URL="http://localhost:3000"))

    assert origins == deployment.DEFAULT_PRODUCTION_CORS_ORIGINS
    assert "http://localhost:3000" not in origins


def test_configured_admin_user_ids_are_csv_normalized(monkeypatch) -> None:
    monkeypatch.setenv("OMNIX_ADMIN_USER_IDS", " admin-1,admin-2 ")

    assert deployment.configured_admin_user_ids(_settings()) == {"admin-1", "admin-2"}
