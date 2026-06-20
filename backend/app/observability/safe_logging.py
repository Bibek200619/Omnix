from __future__ import annotations

from typing import Any

from ..core.config import get_settings


DEVELOPMENT_ENVS = {"dev", "development", "local", "test"}


def allow_sensitive_logging() -> bool:
    settings = get_settings()
    env = str(getattr(settings, "ENV", "") or "").strip().lower()
    return bool(getattr(settings, "DEV_MODE", False)) and env in DEVELOPMENT_ENVS


def safe_text_preview(value: Any, *, max_chars: int = 240) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    if text.startswith("[redacted:") and text.endswith(" chars]"):
        return text
    if not allow_sensitive_logging():
        return f"[redacted:{len(text)} chars]"
    return text[:max_chars]
