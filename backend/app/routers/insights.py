from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, status, Request
from typing import Any

from ..core.security import get_current_user
from ..services.workspace_service import require_workspace_access
from ..services.supabase_service import insert_one, SupabaseServiceError
from ..context.engine import ContextEngine, ContextRetrievalUnavailableError
from ..insights import (
    workspace_summary,
    topic_detection,
    action_item_detector,
    conflict_detector,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workspaces", tags=["insights"])


@router.post("/{workspace_id}/insights/generate")
async def generate_insights(request: Request, workspace_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user = current_user
    user_id = str(user.get("sub"))

    # Ensure user has access
    try:
        await require_workspace_access(workspace_id, user_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Workspace access check failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

    # Assemble a ContextEngine (reuses vector store internally if needed)
    engine = ContextEngine()

    # Run modular insights
    try:
        summary = await workspace_summary.run(engine, user_id, workspace_id)
        topics = await topic_detection.run(engine, user_id, workspace_id)
        actions = await action_item_detector.run(engine, user_id, workspace_id)
        conflicts = await conflict_detector.run(engine, user_id, workspace_id)
    except ContextRetrievalUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Workspace source retrieval is temporarily unavailable. Please retry shortly.",
        ) from exc
    except Exception as exc:
        logger.exception("Failed to generate insights")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to generate workspace insights.") from exc

    combined_markdown = "\n\n---\n\n".join([
        summary.get("markdown", ""),
        topics.get("markdown", ""),
        actions.get("markdown", ""),
        conflicts.get("markdown", ""),
    ])

    payload = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "title": "Workspace Insights",
        "type": "insights",
        "content": combined_markdown,
        "metadata": {
            "summary_structured": summary.get("structured_text"),
            "topics_structured": topics.get("structured_text"),
            "actions_structured": actions.get("structured_text"),
            "conflicts_structured": conflicts.get("structured_text"),
        },
    }

    try:
        artifact = await insert_one("artifacts", payload)
    except SupabaseServiceError:
        logger.exception("Failed to persist insights artifact")
        # non-fatal: return insights but warn
        return {"status": "completed", "warning": "Could not persist insights", "result": {"summary": summary, "topics": topics, "actions": actions, "conflicts": conflicts}}

    return {"status": "completed", "artifact_id": str(artifact.get("id")), "result": {"summary": summary, "topics": topics, "actions": actions, "conflicts": conflicts}}
