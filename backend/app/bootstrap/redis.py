from __future__ import annotations
import logging
from typing import Any
from ..settings import get_settings

try:
    import redis.asyncio as aioredis
except ModuleNotFoundError as exc:
    aioredis = None  # type: ignore[assignment]
    _redis_import_error: ModuleNotFoundError | None = exc
else:
    _redis_import_error = None

logger = logging.getLogger(__name__)

_redis_client: Any | None = None

def _missing_redis_dependency_error() -> RuntimeError:
    return RuntimeError(
        "The Python package 'redis' is required for Omnix distributed state. "
        "Install backend dependencies with `pip install redis>=5.0.0`."
    )

async def initialize_redis():
    global _redis_client
    if aioredis is None:
        raise _missing_redis_dependency_error() from _redis_import_error

    settings = get_settings()
    logger.info(f"Initializing Redis at {settings.REDIS_URL}...")
    
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL, 
            decode_responses=True,
            socket_timeout=5.0,
            socket_connect_timeout=5.0,
            retry_on_timeout=True
        )
        # Verify connection
        await _redis_client.ping()
        logger.info("Redis connection established.")
    return True

def get_redis() -> Any:
    if _redis_client is None:
        # Fallback for lazy initialization if startup event didn't run (e.g. scripts)
        if aioredis is None:
            raise _missing_redis_dependency_error() from _redis_import_error
        
        from ..settings import get_settings
        settings = get_settings()
        # Note: This is synchronous but aioredis.from_url is fast.
        # The actual connection happens on first command.
        return aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    
    return _redis_client
