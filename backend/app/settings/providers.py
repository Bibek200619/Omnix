from __future__ import annotations
from urllib.parse import urlparse
from .base import BaseAppSettings

ALLOWED_MODEL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "18.204.231.209"})
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
STALE_MODEL_ALIASES = {
    "phi3:latest": "phi3:mini",
}

class ProviderSettings(BaseAppSettings):
    MODEL_URL: str = f"{DEFAULT_OLLAMA_BASE_URL}/api/chat"
    AI_MODEL: str = "phi3:mini"
    AI_SYSTEM_PROMPT: str = (
        "You are Omnix, a precise AI workspace assistant. Answer clearly, use the "
        "provided context when it is relevant, and say when you do not know."
    )
    AI_REQUEST_TIMEOUT_SECONDS: float = 60.0
    AI_STREAM_TIMEOUT_SECONDS: float = 120.0
    AI_MAX_RETRIES: int = 2
    AI_MAX_OUTPUT_TOKENS: int = 384
    AI_MAX_CONTEXT_MESSAGES: int = 4
    AI_MAX_CONTEXT_CHARS: int = 8000
    OLLAMA_BASE_URL: str = DEFAULT_OLLAMA_BASE_URL
    OLLAMA_DEFAULT_MODEL: str = "phi3:mini"
    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    RESEND_API_KEY: str | None = None
    RESEND_FROM_EMAIL: str = "Omnix <invites@omnix.app>"
    OMNIX_APP_URL: str = "http://localhost:3000"
    
    @property
    def validated_model_url(self) -> str:
        parsed = urlparse(self.ollama_chat_url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("MODEL_URL must use http or https.")
        if not parsed.hostname or parsed.hostname not in ALLOWED_MODEL_HOSTS:
            raise ValueError("MODEL_URL host is not allowed.")
        return self.ollama_chat_url

    @property
    def ollama_chat_url(self) -> str:
        """Return the native Ollama chat endpoint, correcting stale OpenAI-style MODEL_URL values."""
        base_url = (self.OLLAMA_BASE_URL or "").strip().rstrip("/")

        if not base_url or base_url == DEFAULT_OLLAMA_BASE_URL:
            parsed_model_url = urlparse((self.MODEL_URL or "").strip())
            if parsed_model_url.scheme and parsed_model_url.netloc:
                base_url = f"{parsed_model_url.scheme}://{parsed_model_url.netloc}"

        if not base_url:
            base_url = DEFAULT_OLLAMA_BASE_URL

        return f"{base_url.rstrip('/')}/api/chat"

    @property
    def ollama_model(self) -> str:
        """Return the configured Ollama model, correcting stale deployment aliases."""
        model = (self.AI_MODEL or self.OLLAMA_DEFAULT_MODEL or "phi3:mini").strip()
        return STALE_MODEL_ALIASES.get(model, model)
