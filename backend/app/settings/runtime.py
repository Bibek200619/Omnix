from __future__ import annotations
from .base import BaseAppSettings

class RuntimeSettings(BaseAppSettings):
    WORKER_COUNT: int = 4
    REDIS_URL: str = "redis://localhost:6379/0"
    STREAMING_TIMEOUT: float = 30.0
    OMNIX_PUBLIC_API_DOCS: bool | None = None
    OMNIX_CORS_ALLOWED_ORIGINS: str = ""
    OMNIX_ADMIN_USER_IDS: str = ""
