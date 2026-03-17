from __future__ import annotations

from pathlib import Path
from typing import Optional
from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve backend config from `backend/`, not the repository root. The root
# `.env.local` belongs to the Next.js app and only contains public browser keys.
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILES = [BACKEND_DIR / ".env", BACKEND_DIR / ".env.local"]

class BaseAppSettings(BaseSettings):
    ENV: str = "dev"
    DEV_MODE: bool = True
    
    SUPABASE_URL: str = Field(..., validation_alias=AliasChoices("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"))
    SUPABASE_ANON_KEY: str = Field(..., validation_alias=AliasChoices("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"))
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = Field(None, validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE"))
    SUPABASE_JWKS_URL: Optional[str] = None
    
    model_config = SettingsConfigDict(
        env_file=[str(f) for f in ENV_FILES if f.exists()],
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
