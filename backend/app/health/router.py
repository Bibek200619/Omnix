from __future__ import annotations
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from .checks import run_all_checks
from ..services.workspace_schema_health_service import check_workspace_schema_health
from ..runtime.manager import RuntimeManager

router = APIRouter(prefix="/health", tags=["health"])

@router.get("/live")
async def liveness_check():
    return {"status": "alive"}

@router.get("/ready")
async def readiness_check():
    checks = await run_all_checks()
    if all(c.get("status") == "healthy" for c in checks.values()):
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

@router.get("/providers")
async def provider_health():
    return {"active_providers": RuntimeManager.get().active_providers}
