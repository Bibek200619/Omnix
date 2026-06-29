from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from ..core.security import get_current_user
from ..services.supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_one,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)
from ..services.workspace_service import (
    require_active_workspace_access,
    require_workspace_access,
    _database_error,
)
from ..services.workspace_permissions import OrganizationalAccessAuthority
from ..rag.ingestion import RAGIngestionPipeline
from ..rag.startup import get_vector_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class ArtifactCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1, max_length=255)
    type: str = Field(..., min_length=1, max_length=120)
    content: str = Field(..., min_length=1)
    metadata: dict[str, Any] | None = None


class ArtifactUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, min_length=1)
    metadata: dict[str, Any] | None = None
    pinned: bool | None = None


def _artifact_scope_filters(artifact_id: str, art: dict[str, Any], current_user_id: str) -> dict[str, Any]:
    workspace_id = art.get("workspace_id")
    if workspace_id:
        return {"id": artifact_id, "workspace_id": str(workspace_id)}
    return {"id": artifact_id, "user_id": current_user_id, "workspace_id": {"is": None}}


async def _require_artifact_mutation_access(art: dict[str, Any], current_user_id: str) -> None:
    owner_user_id = str(art.get("user_id") or "")
    workspace_id = art.get("workspace_id")
    if not workspace_id:
        if owner_user_id != current_user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return

    access = await require_workspace_access(str(workspace_id), current_user_id)
    workspace_type = str(access.workspace.get("workspace_type") or "workspace")
    can_manage = OrganizationalAccessAuthority.can_manage_workspace(access.role, workspace_type)
    if owner_user_id == current_user_id or access.is_owner or can_manage:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


async def _delete_artifact_chunks(artifact_id: str, art: dict[str, Any], current_user_id: str) -> None:
    workspace_id = art.get("workspace_id")
    filters: dict[str, Any]
    if workspace_id:
        filters = {"file_id": artifact_id, "workspace_id": str(workspace_id)}
    else:
        filters = {"file_id": artifact_id, "user_id": current_user_id, "workspace_id": {"is": None}}
    await delete_many_trusted("documents", filters)


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
    if workspace_id:
        await require_workspace_access(workspace_id, user_id)

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
    await _require_artifact_mutation_access(art, current_user_id)

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
        updated = await update_one_trusted("artifacts", _artifact_scope_filters(artifact_id, art, current_user_id), update_payload)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    except SupabaseServiceError as exc:
        logger.exception("Failed to update artifact")
        raise _database_error() from exc
    except HTTPException:
        raise

    # If content changed, re-ingest
    if payload.content is not None:
        try:
            vector_store = get_vector_store()
            ingest = RAGIngestionPipeline(vector_store)
            owner_user_id = str(art.get("user_id") or current_user_id)
            await ingest.ingest_text(payload.content, user_id=owner_user_id, document_id=artifact_id, workspace_id=updated.get("workspace_id"))
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
    await _require_artifact_mutation_access(art, current_user_id)

    try:
        await _delete_artifact_chunks(artifact_id, art, current_user_id)
        await delete_many_trusted("artifacts", _artifact_scope_filters(artifact_id, art, current_user_id))
    except SupabaseServiceError as exc:
        logger.exception("Failed to delete artifact")
        raise _database_error() from exc

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
