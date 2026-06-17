from __future__ import annotations
from typing import Any
from urllib.parse import urlparse
from .base import BaseAppSettings

DEFAULT_ALLOWED_MODEL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
ALLOWED_MODEL_HOSTS = DEFAULT_ALLOWED_MODEL_HOSTS
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
STALE_MODEL_ALIASES = {
    "phi3:latest": "phi3:mini",
}


def _normalize_host(value: str) -> str | None:
    candidate = value.strip()
    if not candidate:
        return None

    if "://" not in candidate and candidate.count(":") > 1 and not candidate.startswith("["):
        return candidate.strip("[]").lower()

    parsed = urlparse(candidate if "://" in candidate else f"//{candidate}")
    host = parsed.hostname or candidate
    return host.strip("[]").lower()


def _parse_hosts(value: str | None) -> set[str]:
    if not value:
        return set()
    return {
        host
        for host in (_normalize_host(part) for part in value.split(","))
        if host
    }


class ProviderSettings(BaseAppSettings):
    AI_PROVIDER: str = "auto"
    MODEL_URL: str = f"{DEFAULT_OLLAMA_BASE_URL}/api/chat"
    AI_MODEL: str = "phi3:mini"
    AI_SYSTEM_PROMPT: str = (
        "You are Omnix, a precise AI workspace assistant. Answer clearly using the "
        "provided uploaded document, workspace, and live web context when available. "
        "If WEB SEARCH RESULTS are present, treat them as current evidence and do not "
        "claim you lack live access. Say when the provided sources do not contain the answer."
    )
    AI_REQUEST_TIMEOUT_SECONDS: float = 60.0
    AI_STREAM_TIMEOUT_SECONDS: float = 120.0
    AI_MAX_RETRIES: int = 2
    AI_MAX_OUTPUT_TOKENS: int = 2048
    AI_MAX_CONTEXT_MESSAGES: int = 20
    AI_MAX_CONTEXT_CHARS: int = 16000
    OLLAMA_BASE_URL: str = DEFAULT_OLLAMA_BASE_URL
    OLLAMA_DEFAULT_MODEL: str = "phi3:mini"
    OLLAMA_MAX_OUTPUT_TOKENS: int = 2048
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_MAX_OUTPUT_TOKENS: int = 4096
    ANTHROPIC_API_KEY: str | None = None
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com/v1"
    ANTHROPIC_MODEL: str = "claude-3-5-haiku-latest"
    ANTHROPIC_MAX_OUTPUT_TOKENS: int = 4096
    TAVILY_API_KEY: str | None = None
    WEB_SEARCH_ENABLED: bool | None = None
    WEB_SEARCH_MAX_RESULTS: int = 5
    WEB_SEARCH_TIMEOUT_SECONDS: float = 8.0
    WEB_SEARCH_SNIPPET_MAX_CHARS: int = 700
    WEB_SEARCH_DEPTH: str = "basic"
    WEB_SEARCH_INCLUDE_ANSWER: bool = False
    RESEND_API_KEY: str | None = None
    RESEND_FROM_EMAIL: str = "Omnix <invites@omnix.app>"
    OMNIX_APP_URL: str = "http://localhost:3000"
    OMNIX_SERVER_IP: str | None = None
    OMNIX_ALLOWED_MODEL_HOSTS: str = ""

    def model_post_init(self, __context: Any) -> None:
        object.__setattr__(
            self,
            "WEB_SEARCH_ENABLED",
            bool((self.TAVILY_API_KEY or "").strip()),
        )
    
    @property
    def validated_model_url(self) -> str:
        parsed = urlparse(self.ollama_chat_url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("MODEL_URL must use http or https.")
        hostname = parsed.hostname.lower() if parsed.hostname else None
        if not hostname or hostname not in self.allowed_model_hosts:
            raise ValueError("MODEL_URL host is not allowed.")
        return self.ollama_chat_url

    @property
    def allowed_model_hosts(self) -> frozenset[str]:
        hosts = set(DEFAULT_ALLOWED_MODEL_HOSTS)
        hosts.update(_parse_hosts(self.OMNIX_ALLOWED_MODEL_HOSTS))
        server_ip = _normalize_host(self.OMNIX_SERVER_IP or "")
        if server_ip:
            hosts.add(server_ip)
        return frozenset(hosts)

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
