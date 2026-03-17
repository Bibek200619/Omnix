from __future__ import annotations
import asyncio
import logging
from typing import Dict, Any
from ..db.supabase import get_supabase
from ..rag.startup import get_vector_store

logger = logging.getLogger(__name__)

async def check_supabase() -> Dict[str, Any]:
    try:
        # Simple query to check connectivity
        get_supabase().table("workspaces").select("id").limit(1).execute()
        return {"status": "healthy"}
    except Exception as e:
        logger.error(f"Supabase health check failed: {e}")
        return {"status": "unhealthy", "error": str(e)}

async def check_vector_store() -> Dict[str, Any]:
    try:
        # Vector store is a singleton, check if it's initialized and responsive
        store = get_vector_store()
        # Could add a more rigorous check here if needed
        return {"status": "healthy", "type": store.__class__.__name__}
    except Exception as e:
        logger.error(f"Vector store health check failed: {e}")
        return {"status": "unhealthy", "error": str(e)}

async def check_redis() -> Dict[str, Any]:
    # Placeholder until Redis is fully integrated
    return {"status": "healthy", "info": "Redis check not fully implemented"}

async def run_all_checks() -> Dict[str, Any]:
    results = await asyncio.gather(
        check_supabase(),
        check_vector_store(),
        check_redis(),
        return_exceptions=True
    )
    
    return {
        "supabase": results[0] if not isinstance(results[0], Exception) else {"status": "error", "error": str(results[0])},
        "vector_store": results[1] if not isinstance(results[1], Exception) else {"status": "error", "error": str(results[1])},
        "redis": results[2] if not isinstance(results[2], Exception) else {"status": "error", "error": str(results[2])},
    }
