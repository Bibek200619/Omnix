from __future__ import annotations
from urllib.parse import urlparse
from .base import BaseAppSettings

ALLOWED_MODEL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

class ProviderSettings(BaseAppSettings):
    MODEL_URL: str = "http://localhost:8001/v1/chat/completions"
    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    
    @property
    def validated_model_url(self) -> str:
        parsed = urlparse(self.MODEL_URL)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("MODEL_URL must use http or https.")
        if not parsed.hostname or parsed.hostname not in ALLOWED_MODEL_HOSTS:
            raise ValueError("MODEL_URL host is not allowed.")
        return self.MODEL_URL
