from __future__ import annotations
from typing import Any

from fastapi import APIRouter, Depends

from ..core.security import get_current_user
from ..runtime.manager import RuntimeManager

router = APIRouter(prefix="/admin/runtime", tags=["admin"])

@router.get("/")
async def get_runtime_status(current_user: dict[str, Any] = Depends(get_current_user)):
    return RuntimeManager.get().get_runtime_info()

@router.get("/workers")
async def get_workers(current_user: dict[str, Any] = Depends(get_current_user)):
    workers_dict = RuntimeManager.get().active_workers
    return [
        {
            "id": wid,
            "name": wid,
            "status": info.get("status", "unknown"),
            "last_heartbeat": info.get("registered_at")
        }
        for wid, info in workers_dict.items()
    ]

@router.get("/providers")
async def get_providers(current_user: dict[str, Any] = Depends(get_current_user)):
    return RuntimeManager.get().active_providers

@router.get("/settings")
async def get_current_settings(current_user: dict[str, Any] = Depends(get_current_user)):
    # Only return non-sensitive settings
    from ..settings import get_settings
    settings = get_settings()
    return {
        "ENV": settings.ENV,
        "DEV_MODE": settings.DEV_MODE,
        "HYBRID_TOP_K": settings.HYBRID_TOP_K,
        "ENABLE_TRACING": settings.ENABLE_TRACING,
    }
