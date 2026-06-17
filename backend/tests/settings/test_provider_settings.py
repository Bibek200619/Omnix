from __future__ import annotations

import pytest

from app.settings.providers import ProviderSettings


BASE_SETTINGS = {
    "SUPABASE_URL": "http://localhost:8001",
    "SUPABASE_ANON_KEY": "anon",
    "SUPABASE_SERVICE_ROLE_KEY": "service",
}


def _settings(**overrides: object) -> ProviderSettings:
    return ProviderSettings(_env_file=None, **BASE_SETTINGS, **overrides)


def test_allowed_model_hosts_default_to_loopback_only() -> None:
    settings = _settings(OLLAMA_BASE_URL="http://18.204.231.209:11434")

    with pytest.raises(ValueError, match="MODEL_URL host is not allowed"):
        _ = settings.validated_model_url


def test_allowed_model_hosts_can_be_extended_from_env_setting() -> None:
    settings = _settings(
        OLLAMA_BASE_URL="http://models.internal:11434",
        OMNIX_ALLOWED_MODEL_HOSTS="models.internal, 10.0.0.5",
    )

    assert settings.validated_model_url == "http://models.internal:11434/api/chat"


def test_server_ip_can_extend_allowed_model_hosts() -> None:
    settings = _settings(
        OLLAMA_BASE_URL="http://10.1.2.3:11434",
        OMNIX_SERVER_IP="10.1.2.3",
    )

    assert settings.validated_model_url == "http://10.1.2.3:11434/api/chat"
