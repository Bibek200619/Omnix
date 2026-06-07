from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from urllib.parse import urlparse
import httpx
from ..db.supabase_client import get_supabase
from ..rag.startup import get_vector_store
from ..core.config import get_settings
from ..services.workspace_schema_health_service import check_workspace_schema_health

logger = logging.getLogger(__name__)


async def check_supabase() -> Dict[str, Any]:
    try:
        get_supabase().table("workspaces").select("id").limit(1).execute()
        return {"status": "healthy"}
    except Exception as e:
        logger.error("Supabase health check failed: %s", e)
        return {"status": "unhealthy", "error": str(e)}


async def check_vector_store() -> Dict[str, Any]:
    try:
        store = get_vector_store()
        return {"status": "healthy", "type": store.__class__.__name__}
    except Exception as e:
        logger.error("Vector store health check failed: %s", e)
        return {"status": "unhealthy", "error": str(e)}


async def check_redis() -> Dict[str, Any]:
    """Real Redis connectivity check — no placeholders."""
    try:
        from ..jobs.queue import get_redis
        redis = get_redis()
        pong = await redis.ping()
        return {"status": "healthy", "ping": str(pong)}
    except Exception as e:
        logger.error("Redis health check failed: %s", e)
        return {"status": "unhealthy", "error": str(e)}


async def check_ollama() -> Dict[str, Any]:
    settings = get_settings()
    parsed_chat_url = urlparse(settings.ollama_chat_url)
    base_url = f"{parsed_chat_url.scheme}://{parsed_chat_url.netloc}".rstrip("/")
    expected_model = settings.ollama_model

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
            response = await client.get(f"{base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
    except Exception as e:
        logger.error("Ollama health check failed: %s", e)
        return {
            "status": "unhealthy",
            "error": str(e),
            "base_url": base_url,
            "expected_model": expected_model,
        }

    models = [
        str(model.get("name") or "")
        for model in data.get("models", [])
        if isinstance(model, dict)
    ]
    if expected_model not in models:
        return {
            "status": "unhealthy",
            "error": f"Expected Ollama model {expected_model!r} is not installed.",
            "base_url": base_url,
            "expected_model": expected_model,
            "installed_models": models,
        }

    return {
        "status": "healthy",
        "base_url": base_url,
        "model": expected_model,
        "chat_endpoint": settings.ollama_chat_url,
    }


async def check_ingestion_worker() -> Dict[str, Any]:
    """
    Report ingestion worker health from RuntimeManager (in-process counters)
    plus real Redis queue depth and DB-derived stuck job counts.
    Returns only backend-derived values — no fake metrics.
    """
    from ..runtime.manager import RuntimeManager

    runtime = RuntimeManager.get()
    metrics = runtime.get_ingestion_worker_metrics()

    # Real queue depth from Redis
    queue_depth: int | None = None
    try:
        from ..jobs.queue import get_redis
        import os
        queue_name = os.environ.get("OMNIX_JOB_QUEUE", "omnix:jobs")
        redis = get_redis()
        queue_depth = await redis.llen(queue_name)
    except Exception as exc:
        logger.warning("Could not read queue depth from Redis: %s", exc)

    # Stuck job detection from Supabase (detection only, no auto-repair)
    stuck_10m = await _count_stuck_jobs(minutes=10)
    stuck_30m = await _count_stuck_jobs(minutes=30)
    stuck_60m = await _count_stuck_jobs(minutes=60)

    worker_status = "healthy" if metrics["active_workers"] > 0 else "no_worker"
    if metrics["active_workers"] == 0:
        logger.warning("Ingestion worker health check: no active ingestion workers registered in this process.")

    return {
        "status": worker_status,
        "active_workers": metrics["active_workers"],
        "worker_details": metrics["worker_details"],
        "queue_depth": queue_depth,
        "processing_jobs": metrics["processing_jobs"],
        "completed_jobs": metrics["completed_jobs"],
        "failed_jobs": metrics["failed_jobs"],
        "stuck_jobs": {
            "older_than_10m": stuck_10m,
            "older_than_30m": stuck_30m,
            "older_than_60m": stuck_60m,
        },
    }


async def _count_stuck_jobs(minutes: int) -> int | None:
    """Count jobs with status='queued' older than `minutes` minutes. Detection only."""
    try:
        from ..services.supabase_service import select_all_trusted
        threshold = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
        rows = await select_all_trusted(
            "jobs",
            "id",
            filters={"status": "queued"},
        )
        if rows is None:
            return None
        # Filter by created_at < threshold in Python (avoids complex query syntax)
        stuck = [
            r for r in rows
            if isinstance(r.get("created_at"), str) and r["created_at"] < threshold
        ]
        return len(stuck)
    except Exception as exc:
        logger.warning("Could not count stuck jobs (>%dm): %s", minutes, exc)
        return None


async def run_all_checks() -> Dict[str, Any]:
    results = await asyncio.gather(
        check_supabase(),
        check_workspace_schema_health(),
        check_vector_store(),
        check_redis(),
        check_ollama(),
        check_ingestion_worker(),
        return_exceptions=True,
    )

    return {
        "supabase": results[0] if not isinstance(results[0], Exception) else {"status": "error", "error": str(results[0])},
        "workspace_schema": results[1] if not isinstance(results[1], Exception) else {"status": "error", "error": str(results[1])},
        "vector_store": results[2] if not isinstance(results[2], Exception) else {"status": "error", "error": str(results[2])},
        "redis": results[3] if not isinstance(results[3], Exception) else {"status": "error", "error": str(results[3])},
        "ollama": results[4] if not isinstance(results[4], Exception) else {"status": "error", "error": str(results[4])},
        "ingestion_worker": results[5] if not isinstance(results[5], Exception) else {"status": "error", "error": str(results[5])},
    }
