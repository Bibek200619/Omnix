from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def handle_run_automation(job_row: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = job_row.get("payload")
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            raise ValueError("Invalid automation payload")
        for field in ("automation_id", "workspace_id", "user_id"):
            if not isinstance(payload.get(field), str) or not payload[field].strip():
                raise ValueError("Missing automation identity")

        from ..automation.workspace_jobs import run_automation_job
        from ..services.supabase_service import select_one_trusted
        from ..services.workspace_service import require_workspace_access

        automation_id = payload["automation_id"]
        workspace_id = payload["workspace_id"]
        actor_id = payload["user_id"]
        automation = await select_one_trusted(
            "automations",
            "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id",
            {"id": automation_id, "workspace_id": workspace_id},
        )
        if (
            not automation
            or automation.get("id") != automation_id
            or automation.get("workspace_id") != workspace_id
        ):
            raise ValueError("Automation unavailable")
        owner_id = automation.get("user_id")
        if not isinstance(owner_id, str) or not owner_id.strip():
            raise ValueError("Automation owner unavailable")
        await require_workspace_access(workspace_id, actor_id)
        if owner_id != actor_id:
            await require_workspace_access(workspace_id, owner_id)
        # Workspace-created automations cannot invoke global system maintenance.
        if automation.get("job_type") != "daily_summary":
            raise ValueError("Unsupported workspace automation")
        # An explicit run uses the caller's source permissions, even when another
        # workspace member created the automation. Disabled schedules may run manually.
        result = await run_automation_job({**automation, "user_id": actor_id})
        if (
            not isinstance(result, dict)
            or result.get("error")
            or result.get("status") in {"failed", "deferred"}
            or not result.get("artifact")
        ):
            raise RuntimeError("Automation did not persist a result")
        return {"status": "completed", "result": result}
    except Exception as exc:
        logger.warning("Automation execution failed (%s).", type(exc).__name__)
        return {"status": "failed", "error": "Automation execution failed."}
