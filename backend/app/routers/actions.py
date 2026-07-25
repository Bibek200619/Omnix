from __future__ import annotations

import logging
from fastapi import APIRouter, Request, HTTPException, status
from pydantic import BaseModel
from typing import Any

from ..rag.startup import get_vector_store

from ..context.engine import ContextEngine, ContextRetrievalUnavailableError

from ..actions import summarize as summarize_action
from ..actions import tasks as tasks_action
from ..actions import compare as compare_action
from ..actions import faq as faq_action
from ..actions import notes as notes_action
from ..services.workspace_service import require_workspace_access

router = APIRouter(prefix="/actions", tags=["actions"])
logger = logging.getLogger(__name__)


class ActionRequest(BaseModel):
    action: str
    params: dict | None = None


@router.post("/run")
async def run_action(request: Request, body: ActionRequest) -> Any:
    user = getattr(request.state, "user", None)
    if not user or not isinstance(user, dict) or not user.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    user_id = user.get("sub")
    workspace_id = request.headers.get("X-Omnix-Workspace") or None

    if not workspace_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workspace ID is required")

    await require_workspace_access(workspace_id, user_id)

    # Build unified context engine
    vector_store = get_vector_store()
    engine = ContextEngine(vector_store, max_chunks=8)

    action = body.action.lower().strip()

    # Execution states are intended to be consumed by frontend
    # but here we run synchronously and return structured output
    try:
        if action == "summarize":
            result = await summarize_action.run(engine, user_id, workspace_id)
        elif action == "tasks" or action == "extract_tasks":
            result = await tasks_action.run(engine, user_id, workspace_id)
        elif action == "compare":
            result = await compare_action.run(engine, user_id, workspace_id, params=body.params)
        elif action == "faq":
            result = await faq_action.run(engine, user_id, workspace_id)
        elif action == "notes":
            result = await notes_action.run(engine, user_id, workspace_id)
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown action: {action}")
    except HTTPException:
        raise
    except ContextRetrievalUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Workspace source retrieval is temporarily unavailable. Please retry shortly.",
        ) from exc
    except Exception as exc:
        logger.exception("Failed to run action %s", action)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to perform action.") from exc

    # Persist action output as a workspace artifact
    persistence_warning = None
    ingested = True

    try:
        from ..services.supabase_service import insert_one as db_insert_one
        from ..rag.ingestion import RAGIngestionPipeline

        title = f"{action.capitalize()} - generated"
        artifact_payload = {
            "user_id": user_id,
            "workspace_id": workspace_id,
            "title": title,
            "type": action,
            "content": result.get("markdown") if isinstance(result, dict) else str(result),
            "metadata": {"action_params": body.params or {}, "citations": result.get("citations") if isinstance(result, dict) else []},
        }
        artifact = await db_insert_one("artifacts", artifact_payload)

        # ingest text into RAG index (best-effort)
        try:
            vector_store = get_vector_store()
            ingestion = RAGIngestionPipeline(vector_store)
            await ingestion.ingest_text(artifact_payload["content"], user_id=user_id, document_id=str(artifact["id"]), workspace_id=workspace_id)
        except Exception as exc:
            logger.warning(
                "Vector ingestion failed for action=%s workspace_id=%s user_id=%s: %s",
                action, workspace_id, user_id, exc,
            )
            ingested = False

        # augment result with artifact reference
        if isinstance(result, dict):
            result["artifact_id"] = str(artifact.get("id"))
    except Exception as exc:
        logger.warning(
            "Artifact persistence failed for action=%s workspace_id=%s user_id=%s: %s",
            action, workspace_id, user_id, exc,
        )
        persistence_warning = "Result generated but could not be saved. Please retry."
        ingested = False

    response = {
        "status": "completed",
        "steps": [
            "Retrieving documents...",
            "Analyzing workspace...",
            "Generating output...",
            "Finalizing report...",
        ],
        "result": result,
        "ingested": ingested,
    }
    if persistence_warning:
        response["warning"] = persistence_warning
    return response
