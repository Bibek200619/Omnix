from __future__ import annotations
import asyncio
import logging
from ..db.supabase_client import close_async_supabase
from ..rag.startup import shutdown_vector_store
from ..runtime.manager import RuntimeManager

logger = logging.getLogger(__name__)

async def graceful_shutdown():
    logger.info("Starting graceful shutdown...")
    RuntimeManager.get().set_status("shutting_down")
    
    # 1. Drain workers (placeholder)
    logger.info("Draining workers...")
    await asyncio.sleep(0.5)
    
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
