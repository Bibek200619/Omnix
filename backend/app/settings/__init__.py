from __future__ import annotations
from functools import lru_cache

from .retrieval import RetrievalSettings
from .providers import ProviderSettings
from .observability import ObservabilitySettings
from .runtime import RuntimeSettings

class Settings(RetrievalSettings, ProviderSettings, ObservabilitySettings, RuntimeSettings):
    pass

@lru_cache
def get_settings() -> Settings:
    return Settings()
