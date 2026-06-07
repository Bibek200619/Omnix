from __future__ import annotations
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from .checks import run_all_checks, check_ingestion_worker
from ..services.workspace_schema_health_service import check_workspace_schema_health
from ..runtime.manager import RuntimeManager

router = APIRouter(prefix="/health", tags=["health"])

@router.get("/live")
async def liveness_check():
    return {"status": "alive"}

@router.get("/ready")
async def readiness_check():
    checks = await run_all_checks()
    if all(c.get("status") in {"healthy", "degraded", "no_worker"} for c in checks.values()):
        return {"status": "ready", "checks": checks}
    return JSONResponse(status_code=503, content={"status": "not_ready", "checks": checks})

@router.get("/schema")
async def schema_health():
    result = await check_workspace_schema_health()
    if result.get("status") == "healthy":
        return result
    return JSONResponse(status_code=503, content=result)

@router.get("/runtime")
async def runtime_health():
    return RuntimeManager.get().get_runtime_info()

@router.get("/workers")
async def worker_health():
    return RuntimeManager.get().active_workers

@router.get("/ingestion-worker")
async def ingestion_worker_health():
    """
    Dedicated endpoint for ingestion worker health visibility.

    Returns:
    - active_workers: number of ingestion workers registered in this process
    - worker_details: per-worker registration info and status
    - queue_depth: live Redis queue depth (pending jobs)
    - processing_jobs: jobs currently being processed
    - completed_jobs: jobs completed since worker start
    - failed_jobs: jobs failed since worker start
    - stuck_jobs: counts of queued jobs older than 10/30/60 minutes
    """
    result = await check_ingestion_worker()
    return result

@router.get("/providers")
async def provider_health():
    return {"active_providers": RuntimeManager.get().active_providers}
