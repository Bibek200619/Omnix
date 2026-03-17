from __future__ import annotations
from fastapi import APIRouter, Depends
from ..runtime.manager import RuntimeManager
from ..core.security import get_current_user

router = APIRouter(prefix="/admin/runtime", tags=["admin"])

@router.get("/")
async def get_runtime_status():
    return RuntimeManager.get().get_runtime_info()

@router.get("/workers")
async def get_workers():
    return RuntimeManager.get().active_workers

@router.get("/providers")
async def get_providers():
    return RuntimeManager.get().active_providers

@router.get("/settings")
async def get_current_settings():
    # Only return non-sensitive settings
    from ..settings import get_settings
    settings = get_settings()
    return {
        "ENV": settings.ENV,
        "DEV_MODE": settings.DEV_MODE,
        "HYBRID_TOP_K": settings.HYBRID_TOP_K,
        "ENABLE_TRACING": settings.ENABLE_TRACING,
    }
