from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWKS_URL: str | None = None
    MODEL_URL: str = "http://localhost:8000/v1/chat/completions"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def jwks_url(self) -> str:
        if self.SUPABASE_JWKS_URL:
            return self.SUPABASE_JWKS_URL
        return f"{self.SUPABASE_URL}/auth/v1/.well-known/jwks.json"


settings = Settings()
