from __future__ import annotations

import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from ..services.workspace_service import require_workspace_access
from ..services.supabase_service import (
    insert_one_trusted,
    select_all_trusted,
    update_one_trusted,
)
from ..automation.scheduler import AutomationScheduler

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workspaces", tags=["automations"])


@router.get("/{workspace_id}/automations")
async def list_automations(workspace_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted("automations", "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id,created_at,updated_at", {"workspace_id": workspace_id})
        return rows
    except Exception:
        logger.exception("Failed to list automations")
        return []


@router.post("/{workspace_id}/automations", status_code=status.HTTP_201_CREATED)
async def create_automation(workspace_id: str, payload: dict[str, Any], current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    record = {
        "workspace_id": workspace_id,
        "user_id": user_id,
        "name": payload.get("name") or "automation",
        "job_type": payload.get("job_type"),
        "schedule": payload.get("schedule"),
        "interval_seconds": int(payload.get("interval_seconds") or 0),
        "enabled": bool(payload.get("enabled") or False),
    }
    try:
        created = await insert_one_trusted("automations", record)
        return created
    except Exception as exc:
        logger.exception("Failed to create automation: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create automation")


@router.post("/{workspace_id}/automations/{automation_id}/run")
async def run_automation_now(workspace_id: str, automation_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted("automations", "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id", {"id": automation_id, "workspace_id": workspace_id})
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Automation not found")
        automation = rows[0]
        # run in background
        import asyncio
        scheduler = AutomationScheduler.get()
        asyncio.create_task(scheduler.run_now(automation))
        return {"status": "started"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to run automation now: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to run automation")


@router.patch("/{workspace_id}/automations/{automation_id}")
async def update_automation(workspace_id: str, automation_id: str, payload: dict[str, Any], current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    allowed_fields = {"name", "job_type", "schedule", "interval_seconds", "enabled"}
    update_payload = {key: value for key, value in payload.items() if key in allowed_fields}
    if "interval_seconds" in update_payload:
        update_payload["interval_seconds"] = int(update_payload["interval_seconds"] or 0)
    if "enabled" in update_payload:
        update_payload["enabled"] = bool(update_payload["enabled"])
    if not update_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No supported automation fields provided")
    try:
        updated = await update_one_trusted(
            "automations",
            {"id": automation_id, "workspace_id": workspace_id},
            update_payload,
        )
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Automation not found")
        return updated
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to update automation: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update automation")
