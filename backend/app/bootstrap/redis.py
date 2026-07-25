from __future__ import annotations
import asyncio
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
_REDIS_SOCKET_TIMEOUT_SECONDS = 5.0
_REDIS_INITIALIZATION_TIMEOUT_SECONDS = 6.0

def _missing_redis_dependency_error() -> RuntimeError:
    return RuntimeError(
        "The Python package 'redis' is required for Omnix distributed state. "
        "Install backend dependencies with `pip install redis>=5.0.0`."
    )

def _build_redis_client() -> Any:
    if aioredis is None:
        raise _missing_redis_dependency_error() from _redis_import_error

    settings = get_settings()
    return aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_timeout=_REDIS_SOCKET_TIMEOUT_SECONDS,
        socket_connect_timeout=_REDIS_SOCKET_TIMEOUT_SECONDS,
        retry_on_timeout=True,
    )


async def initialize_redis() -> bool:
    logger.info("Initializing Redis distributed state.")
    client = get_redis()
    await asyncio.wait_for(client.ping(), timeout=_REDIS_INITIALIZATION_TIMEOUT_SECONDS)
    logger.info("Redis connection established.")
    return True


def get_redis() -> Any:
    global _redis_client
    if _redis_client is None:
        # The connection is established lazily on the first command. Cache the
        # client here as well as during app startup so workers and scripts use
        # the same bounded connection settings.
        _redis_client = _build_redis_client()
    return _redis_client
