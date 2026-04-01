from __future__ import annotations
from urllib.parse import urlparse
from .base import BaseAppSettings

ALLOWED_MODEL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

class ProviderSettings(BaseAppSettings):
    MODEL_URL: str = "http://localhost:11434/v1/chat/completions"
    AI_MODEL: str = "gemma:2b"
    AI_SYSTEM_PROMPT: str = (
        "You are Omnix, a precise AI workspace assistant. Answer clearly, use the "
        "provided context when it is relevant, and say when you do not know."
    )
    AI_REQUEST_TIMEOUT_SECONDS: float = 60.0
    AI_STREAM_TIMEOUT_SECONDS: float = 120.0
    AI_MAX_RETRIES: int = 2
    AI_MAX_OUTPUT_TOKENS: int = 900
    AI_MAX_CONTEXT_MESSAGES: int = 20
    AI_MAX_CONTEXT_CHARS: int = 16000
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_DEFAULT_MODEL: str = "gemma:2b"
    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    RESEND_API_KEY: str | None = None
    RESEND_FROM_EMAIL: str = "Omnix <invites@omnix.app>"
    OMNIX_APP_URL: str = "http://localhost:3000"
    
    @property
    def validated_model_url(self) -> str:
        parsed = urlparse(self.MODEL_URL)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("MODEL_URL must use http or https.")
        if not parsed.hostname or parsed.hostname not in ALLOWED_MODEL_HOSTS:
            raise ValueError("MODEL_URL host is not allowed.")
        return self.MODEL_URL
