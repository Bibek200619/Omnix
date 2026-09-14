from __future__ import annotations
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from .checks import run_all_checks, run_operational_checks, check_ingestion_worker
from ..core.admin_auth import require_runtime_admin
from ..services.workspace_schema_health_service import check_workspace_schema_health
from ..runtime.manager import RuntimeManager
from ..core.security import get_current_user

router = APIRouter(prefix="/health", tags=["health"])

@router.get("/live")
async def liveness_check():
    return {"status": "alive"}

@router.get("/ready")
async def readiness_check():
    checks = await run_all_checks(include_internal=False)
    if all(c.get("status") in {"healthy", "warning", "degraded", "no_worker"} for c in checks.values()):
        return {"status": "ready"}
    return JSONResponse(status_code=503, content={"status": "not_ready"})

@router.get("/schema")
async def schema_health(current_user: dict[str, Any] = Depends(get_current_user)):
    result = await check_workspace_schema_health()
    if result.get("status") == "healthy":
        return result
    return JSONResponse(status_code=503, content=result)

@router.get("/runtime")
async def runtime_health(current_user: dict[str, Any] = Depends(get_current_user)):
    return RuntimeManager.get().get_runtime_info()

@router.get("/workers")
async def worker_health(current_user: dict[str, Any] = Depends(get_current_user)):
    return RuntimeManager.get().active_workers

@router.get("/ingestion-worker")
async def ingestion_worker_health(current_user: dict[str, Any] = Depends(get_current_user)):
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
async def provider_health(current_user: dict[str, Any] = Depends(get_current_user)):
    return {"active_providers": RuntimeManager.get().active_providers}

@router.get("/operational")
async def operational_health(current_user: dict[str, Any] = Depends(require_runtime_admin)):
    return await run_operational_checks()
