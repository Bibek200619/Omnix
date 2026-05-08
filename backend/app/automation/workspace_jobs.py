from typing import Any
import logging
from datetime import datetime, timezone

from ..context.engine import ContextEngine
from ..insights import workspace_summary, topic_detection
from ..services.supabase_service import insert_one_trusted

logger = logging.getLogger(__name__)


async def run_automation_job(automation: dict[str, Any]) -> dict[str, Any]:
    """Dispatch automation job by type. Returns result dict."""
    job_type = automation.get("job_type")
    workspace_id = automation.get("workspace_id")
    user_id = automation.get("user_id") or "system"

    engine = ContextEngine()
    results: dict[str, Any] = {}

    if job_type == "daily_summary":
        summary = await workspace_summary.run(engine, user_id, workspace_id)
        topics = await topic_detection.run(engine, user_id, workspace_id)
        combined = "\n\n---\n\n".join([summary.get("markdown", ""), topics.get("markdown", "")])
        payload = {
            "user_id": user_id,
            "workspace_id": workspace_id,
            "title": f"Automation: {automation.get('name') or job_type}",
            "type": "automation_insight",
            "content": combined,
            "metadata": {"automation_id": automation.get("id"), "job_type": job_type},
        }
        try:
            art = await insert_one_trusted("artifacts", payload)
            results["artifact"] = art
        except Exception:
            logger.exception("Failed to persist automation artifact")
            results["artifact"] = None

    else:
        logger.warning("Unknown automation job_type: %s", job_type)
        results["error"] = "unknown job_type"

    return results
