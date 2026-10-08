from __future__ import annotations

import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from ..core.security import get_current_user
from ..jobs import queue as job_queue
from ..services.workspace_service import require_workspace_access
from ..services.supabase_service import (
    delete_one_trusted,
    insert_one_trusted,
    select_all_trusted,
    update_one_trusted,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workspaces", tags=["automations"])


class AutomationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    job_type: str | None = Field(default=None, max_length=120)
    schedule: dict[str, Any] | str | None = None
    interval_seconds: int | None = Field(default=None, ge=0, le=31_536_000)
    enabled: bool | None = False


class AutomationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    job_type: str | None = Field(default=None, max_length=120)
    schedule: dict[str, Any] | str | None = None
    interval_seconds: int | None = Field(default=None, ge=0, le=31_536_000)
    enabled: bool | None = None


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
async def create_automation(workspace_id: str, payload: AutomationCreate, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    record = {
        "workspace_id": workspace_id,
        "user_id": user_id,
        "name": payload.name or "automation",
        "job_type": payload.job_type,
        "schedule": payload.schedule,
        "interval_seconds": int(payload.interval_seconds or 0),
        "enabled": bool(payload.enabled or False),
    }
    try:
        created = await insert_one_trusted("automations", record)
        return created
    except Exception as exc:
        logger.exception("Failed to create automation: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create automation")


@router.post(
    "/{workspace_id}/automations/{automation_id}/run",
    status_code=status.HTTP_202_ACCEPTED,
)
async def run_automation_now(
    workspace_id: str,
    automation_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "automations",
            "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id",
            {"id": automation_id, "workspace_id": workspace_id},
        )
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Automation not found"
            )
        try:
            job_id = await job_queue.enqueue_job(
                {
                    "type": "run_automation",
                    "automation_id": automation_id,
                    "workspace_id": workspace_id,
                    "user_id": user_id,
                },
                queue=job_queue.primary_job_queue(),
            )
        except job_queue.JobEnqueueError as exc:
            if not exc.persisted:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Unable to queue automation. Please retry.",
                ) from exc
            # The canonical row survives Redis delivery failure and is recovered
            # by the worker's database fallback.
            job_id = exc.job_id
        return {"status": "queued", "job_id": job_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Failed to queue automation (%s).", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to run automation",
        )


@router.patch("/{workspace_id}/automations/{automation_id}")
async def update_automation(workspace_id: str, automation_id: str, payload: AutomationUpdate, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    update_payload = payload.model_dump(exclude_unset=True)
    if not update_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No changes provided")
    try:
        updated = await update_one_trusted("automations", {"id": automation_id, "workspace_id": workspace_id}, update_payload)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Automation not found")
        return updated
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to update automation: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update automation")


@router.delete("/{workspace_id}/automations/{automation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_automation(workspace_id: str, automation_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> None:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    try:
        deleted = await delete_one_trusted("automations", {"id": automation_id, "workspace_id": workspace_id})
        if deleted is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Automation not found")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to delete automation: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete automation")
