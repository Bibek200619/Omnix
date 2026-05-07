from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from ..core.security import get_current_user
from ..services.supabase_service import (
    SupabaseServiceError,
    insert_one,
    insert_many,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
    delete_many_trusted,
)
from ..services.workspace_service import (
    require_active_workspace_access,
    require_workspace_access,
    _database_error,
)
from ..rag.ingestion import RAGIngestionPipeline
from ..rag.startup import get_vector_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class ArtifactCreate(BaseModel):
    title: str
    type: str
    content: str
    metadata: dict | None = None


class ArtifactUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    metadata: dict | None = None
    pinned: bool | None = None


@router.get("", response_model=list[dict])
async def list_artifacts(request: Request, current_user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    user_id = str(current_user["sub"])
    access = await require_active_workspace_access(request, user_id)
    if access is None:
        # return user's personal artifacts
        try:
            rows = await select_all_trusted("artifacts", "id,workspace_id,user_id,title,type,created_at,updated_at,pinned,metadata", filters={"user_id": user_id}, order_by="created_at", desc=True)
            return rows
        except SupabaseServiceError as exc:
            logger.exception("Failed to list personal artifacts")
            raise _database_error() from exc

    workspace_id = access.workspace.get("id")
    try:
        rows = await select_all_trusted(
            "artifacts",
            "id,workspace_id,user_id,title,type,created_at,updated_at,pinned,metadata",
            filters={"workspace_id": str(workspace_id)},
            order_by="created_at",
            desc=True,
        )
        return rows
    except SupabaseServiceError as exc:
        logger.exception("Failed to list workspace artifacts")
        raise _database_error() from exc


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_artifact(request: Request, payload: ArtifactCreate, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = str(current_user["sub"])
    workspace_id = request.headers.get("X-Omnix-Workspace") or None

    db_payload = {
        "user_id": user_id,
        "title": payload.title,
        "type": payload.type,
        "content": payload.content,
        "metadata": payload.metadata or {},
        "workspace_id": workspace_id,
    }

    try:
        artifact = await insert_one("artifacts", db_payload)
    except SupabaseServiceError as exc:
        logger.exception("Failed to create artifact")
        raise _database_error() from exc

    # Ingest artifact content into RAG documents and vector store for retrieval
    try:
        vector_store = get_vector_store()
        ingest = RAGIngestionPipeline(vector_store)
        # Use artifact id as document/file id so retrieval citations may reference it
        await ingest.ingest_text(payload.content, user_id=user_id, document_id=str(artifact["id"]), workspace_id=workspace_id)
    except Exception:
        logger.exception("Non-fatal: failed to ingest artifact into RAG index.")

    return artifact


@router.get("/{artifact_id}")
async def get_artifact(artifact_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    try:
        art = await select_one_trusted("artifacts", "id,workspace_id,user_id,title,type,content,created_at,updated_at,pinned,metadata", {"id": artifact_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to fetch artifact")
        raise _database_error() from exc

    if art is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")

    # enforce workspace access when applicable
    if art.get("workspace_id"):
        workspace_id = str(art["workspace_id"])
        # ensure caller has workspace access
        await require_workspace_access(workspace_id, str(current_user["sub"]))
    else:
        if str(art.get("user_id")) != str(current_user["sub"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    return art


@router.patch("/{artifact_id}")
async def update_artifact(artifact_id: str, payload: ArtifactUpdate, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    try:
        art = await select_one_trusted("artifacts", "id,workspace_id,user_id", {"id": artifact_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to fetch artifact for update")
        raise _database_error() from exc

    if art is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")

    current_user_id = str(current_user["sub"])
    # permission: creator or workspace owner
    if art.get("workspace_id"):
        await require_workspace_access(str(art["workspace_id"]), current_user_id)
    else:
        if str(art.get("user_id")) != current_user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    update_payload: dict[str, Any] = {}
    if payload.title is not None:
        update_payload["title"] = payload.title
    if payload.content is not None:
        update_payload["content"] = payload.content
    if payload.metadata is not None:
        update_payload["metadata"] = payload.metadata
    if payload.pinned is not None:
        update_payload["pinned"] = payload.pinned

    if not update_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No changes provided")

    try:
        updated = await update_one_trusted("artifacts", {"id": artifact_id}, update_payload)
    except SupabaseServiceError as exc:
        logger.exception("Failed to update artifact")
        raise _database_error() from exc

    # If content changed, re-ingest
    if payload.content is not None:
        try:
            vector_store = get_vector_store()
            ingest = RAGIngestionPipeline(vector_store)
            await ingest.ingest_text(payload.content, user_id=current_user_id, document_id=artifact_id, workspace_id=updated.get("workspace_id"))
        except Exception:
            logger.exception("Non-fatal: failed to re-ingest updated artifact content.")

    return updated


@router.delete("/{artifact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artifact(artifact_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> Response:
    try:
        art = await select_one_trusted("artifacts", "id,workspace_id,user_id", {"id": artifact_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to fetch artifact for delete")
        raise _database_error() from exc

    if art is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")

    current_user_id = str(current_user["sub"])
    if art.get("workspace_id"):
        await require_workspace_access(str(art["workspace_id"]), current_user_id)
    else:
        if str(art.get("user_id")) != current_user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    try:
        await delete_many_trusted("artifacts", {"id": artifact_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to delete artifact")
        raise _database_error() from exc

    # Note: we do not delete related document chunks here; could be a future cleanup task.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{artifact_id}/export")
async def export_artifact(artifact_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> Response:
    try:
        art = await select_one_trusted("artifacts", "id,workspace_id,user_id,title,type,content", {"id": artifact_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to fetch artifact for export")
        raise _database_error() from exc

    if art is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")

    # Authorization same as get
    if art.get("workspace_id"):
        await require_workspace_access(str(art["workspace_id"]), str(current_user["sub"]))
    else:
        if str(art.get("user_id")) != str(current_user["sub"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    md = art.get("content") or ""
    headers = {"Content-Disposition": f"attachment; filename=artifact-{artifact_id}.md"}
    return Response(content=md, media_type="text/markdown", headers=headers)
