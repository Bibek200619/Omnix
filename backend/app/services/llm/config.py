from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class LLMSettings(BaseSettings):
    # Provider Selection
    DEFAULT_PROVIDER: str = "placeholder" # Options: placeholder, openai, ollama, local
    FALLBACK_PROVIDER: str = "placeholder"

    # OpenAI Settings
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_DEFAULT_MODEL: str = "gpt-4-turbo"

    # Ollama Settings
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_DEFAULT_MODEL: str = "phi3:mini"
    OLLAMA_TIMEOUT_SECONDS: int = 60

    # Local Model Settings (Future)
    LOCAL_MODEL_PATH: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

llm_settings = LLMSettings()
