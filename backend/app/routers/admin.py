from __future__ import annotations
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.deployment import configured_admin_user_ids
from ..core.security import get_current_user
from ..runtime.manager import RuntimeManager


def _metadata_has_admin_role(metadata: Any) -> bool:
    if not isinstance(metadata, dict):
        return False
    if metadata.get("omnix_admin") is True or metadata.get("is_admin") is True:
        return True
    role = str(metadata.get("omnix_role") or metadata.get("app_role") or "").strip().lower()
    if role == "admin":
        return True
    roles = metadata.get("roles")
    if isinstance(roles, list):
        return any(str(item).strip().lower() == "admin" for item in roles)
    return False


async def require_admin_user(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = str(current_user.get("sub") or "")
    if user_id and user_id in configured_admin_user_ids():
        return current_user
    if _metadata_has_admin_role(current_user.get("app_metadata")):
        return current_user
    if _metadata_has_admin_role(current_user.get("user_metadata")):
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin privileges are required.",
    )


router = APIRouter(prefix="/admin/runtime", tags=["admin"], dependencies=[Depends(require_admin_user)])

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
