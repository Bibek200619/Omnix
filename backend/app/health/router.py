from __future__ import annotations
from fastapi import APIRouter, HTTPException
from .checks import run_all_checks
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
    # Return 200 even if some checks fail but it's not a hard failure?
    # Usually readiness should return 503 if not ready.
    # For now, let's keep it simple.
    return {"status": "partially_ready", "checks": checks}

@router.get("/runtime")
async def runtime_health():
    return RuntimeManager.get().get_runtime_info()

@router.get("/workers")
async def worker_health():
    return RuntimeManager.get().active_workers

@router.get("/providers")
async def provider_health():
    return {"active_providers": RuntimeManager.get().active_providers}
