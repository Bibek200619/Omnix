from __future__ import annotations

import logging

from .middleware import drain_api_log_tasks
from .redis import close_redis
from ..db.supabase_client import close_async_supabase
from ..rag.startup import shutdown_vector_store
from ..runtime.manager import RuntimeManager
from ..settings import get_settings

logger = logging.getLogger(__name__)
_DEFAULT_API_LOG_DRAIN_TIMEOUT_SECONDS = 10.0


async def graceful_shutdown(*, api_log_drain_timeout_seconds: float | None = None) -> None:
    logger.info("Starting graceful shutdown...")
    runtime = RuntimeManager.get()
    runtime.set_status("shutting_down")

    try:
        timeout_seconds = api_log_drain_timeout_seconds
        if timeout_seconds is None:
            try:
                timeout_seconds = get_settings().OMNIX_API_LOG_DRAIN_TIMEOUT_SECONDS
            except Exception:
                timeout_seconds = _DEFAULT_API_LOG_DRAIN_TIMEOUT_SECONDS
                logger.exception(
                    "Unable to load API log drain timeout; using %.2f seconds.",
                    timeout_seconds,
                )

        try:
            completed, timed_out = await drain_api_log_tasks(
                timeout_seconds=max(timeout_seconds, 0.0),
            )
            logger.info(
                "API log shutdown drain complete | completed=%d | timed_out=%d",
                completed,
                timed_out,
            )
        except Exception:
            logger.exception("Error draining API log writes.")

        try:
            await shutdown_vector_store()
            logger.info("Vector store shut down.")
        except Exception:
            logger.exception("Error shutting down vector store.")

        try:
            await close_async_supabase()
            logger.info("Async Supabase client shut down.")
        except Exception:
            logger.exception("Error shutting down async Supabase client.")

        try:
            await close_redis()
            logger.info("Redis client shut down.")
        except Exception:
            logger.exception("Error shutting down Redis client.")
    finally:
        runtime.set_status("terminated")
        logger.info("Graceful shutdown complete.")
