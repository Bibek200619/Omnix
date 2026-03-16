from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict

ALLOWED_MODEL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
# Resolve `.env` from `backend/` so imports from the repo root still load the same config.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWKS_URL: str | None = None
    DEV_MODE: bool = True
    MODEL_URL: str = "http://localhost:8001/v1/chat/completions"
    SIMILARITY_THRESHOLD: float = 1.5
    HYBRID_TOP_K: int = 8
    HYBRID_POOL_SIZE: int = 16
    HYBRID_SEMANTIC_WEIGHT: float = 0.7
    HYBRID_KEYWORD_WEIGHT: float = 0.3
    HYBRID_DYNAMIC_WEIGHTING: bool = True
    HYBRID_CONTEXT_TOKEN_BUDGET: int = 2600
    HYBRID_MAX_CHUNK_TOKENS: int = 650

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def supabase_base_url(self) -> str:
        return self.SUPABASE_URL.rstrip("/")

    @property
    def jwks_url(self) -> str:
        if self.SUPABASE_JWKS_URL:
            return self.SUPABASE_JWKS_URL
        return f"{self.supabase_base_url}/auth/v1/.well-known/jwks.json"

    @property
    def validated_model_url(self) -> str:
        parsed = urlparse(self.MODEL_URL)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("MODEL_URL must use http or https.")
        if not parsed.hostname or parsed.hostname not in ALLOWED_MODEL_HOSTS:
            raise ValueError("MODEL_URL host is not allowed.")
        return self.MODEL_URL


@lru_cache
def get_settings() -> Settings:
    return Settings()
