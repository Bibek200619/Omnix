from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def handle_run_automation(job_row: dict[str, Any]) -> dict[str, Any]:
    payload = job_row.get("payload")
    # For now, delegate to existing automation runners in automation package
    try:
        automation_id = payload.get("automation_id")
        from ..automation.workspace_jobs import run_automation_by_id

        result = await run_automation_by_id(automation_id, payload=payload)
        return {"status": "completed", "result": result}
    except Exception as exc:
        logger.exception("Automation job failed: %s", exc)
        return {"status": "failed", "error": str(exc)}
