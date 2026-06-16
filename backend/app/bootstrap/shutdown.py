from __future__ import annotations
import asyncio
import logging
import os
from ..db.supabase_client import close_async_supabase
from ..rag.startup import shutdown_vector_store
from ..runtime.manager import RuntimeManager

logger = logging.getLogger(__name__)

DEFAULT_DRAIN_TIMEOUT_SECONDS = float(os.environ.get("OMNIX_SHUTDOWN_DRAIN_TIMEOUT_SECONDS", "5"))


async def drain_workers(timeout_seconds: float = DEFAULT_DRAIN_TIMEOUT_SECONDS) -> bool:
    runtime = RuntimeManager.get()
    deadline = asyncio.get_running_loop().time() + max(0.0, timeout_seconds)
    while runtime.get_ingestion_worker_metrics().get("processing_jobs", 0) > 0:
        if asyncio.get_running_loop().time() >= deadline:
            logger.warning(
                "Worker drain timed out with %s processing jobs.",
                runtime.get_ingestion_worker_metrics().get("processing_jobs", 0),
            )
            return False
        await asyncio.sleep(0.1)
    logger.info("Worker drain complete.")
    return True


async def graceful_shutdown():
    logger.info("Starting graceful shutdown...")
    RuntimeManager.get().set_status("shutting_down")
    
    # 1. Drain workers
    logger.info("Draining workers...")
    await drain_workers()
    
    # 2. Shutdown Vector Store
    try:
        await shutdown_vector_store()
        logger.info("Vector Store shut down.")
    except Exception as e:
        logger.error(f"Error shutting down Vector Store: {e}")

    try:
        await close_async_supabase()
        logger.info("Async Supabase client shut down.")
    except Exception as e:
        logger.error(f"Error shutting down async Supabase client: {e}")
        
    # 3. Final cleanup
    RuntimeManager.get().set_status("terminated")
    logger.info("Graceful shutdown complete.")
