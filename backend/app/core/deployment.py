from __future__ import annotations

import os
from typing import Any


DEV_ENVIRONMENTS = {"dev", "development", "local", "test"}


def _split_csv(value: Any) -> list[str]:
    if not isinstance(value, str):
        return []
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


def _is_local_origin(origin: str) -> bool:
    normalized = origin.strip().lower()
    return normalized.startswith("http://localhost") or normalized.startswith("http://127.0.0.1")


def is_development_mode(settings: Any | None = None) -> bool:
    if settings is None:
        from .config import get_settings

        settings = get_settings()
    env = str(getattr(settings, "ENV", "") or "").strip().lower()
    return bool(getattr(settings, "DEV_MODE", False)) or env in DEV_ENVIRONMENTS


def public_api_docs_enabled(settings: Any | None = None) -> bool:
    if settings is None:
        from .config import get_settings

        settings = get_settings()
    override = getattr(settings, "OMNIX_PUBLIC_API_DOCS", None)
    if override is not None:
        return bool(override)
    return is_development_mode(settings)


def cors_allowed_origins(settings: Any | None = None) -> list[str]:
    if settings is None:
        from .config import get_settings

        settings = get_settings()

    origins = _split_csv(
        os.environ.get("OMNIX_CORS_ALLOWED_ORIGINS")
        or getattr(settings, "OMNIX_CORS_ALLOWED_ORIGINS", "")
    )
    if origins and ("*" not in origins or is_development_mode(settings)):
        return origins

    frontend_url = (
        os.environ.get("OMNIX_FRONTEND_URL")
        or getattr(settings, "OMNIX_FRONTEND_URL", "")
        or getattr(settings, "OMNIX_APP_URL", "")
    )
    fallback_origins = _split_csv(frontend_url)
    if fallback_origins:
        if not is_development_mode(settings) and any(_is_local_origin(origin) for origin in fallback_origins):
            return []
        return fallback_origins

    if is_development_mode(settings):
        return ["*"]
    return []


def cors_allow_credentials(origins: list[str]) -> bool:
    return "*" not in origins


def configured_admin_user_ids(settings: Any | None = None) -> set[str]:
    if settings is None:
        from .config import get_settings

        settings = get_settings()
    configured = (
        os.environ.get("OMNIX_ADMIN_USER_IDS")
        or getattr(settings, "OMNIX_ADMIN_USER_IDS", "")
    )
    return set(_split_csv(configured))
