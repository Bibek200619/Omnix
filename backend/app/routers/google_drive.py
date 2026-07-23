from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse, JSONResponse

from ..core.security import get_current_user
from ..services.workspace_service import require_workspace_access, resolve_workspace_access
from ..integrations.google_drive import (
    build_oauth_authorize_url,
    build_oauth_state,
    exchange_code_for_tokens,
    store_token_for_user,
    get_token_for_user,
    list_drive_files_for_user,
    download_drive_file_bytes,
    parse_oauth_state,
)
from ..jobs import queue as job_queue
from ..services.document_intelligence_service import ExtractionDiagnostics, extraction_columns_payload
from ..services.supabase_service import SupabaseServiceError, insert_one, update_one
from ..services.file_storage import sanitize_filename, save_bytes_to_user_upload
from ..services.workspace_service import require_workspace_access, resolve_workspace_access

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/integrations/google_drive", tags=["integrations"])


async def _update_import_processing_state(
    file_row: dict[str, Any],
    *,
    user_id: str,
    processing_status: str,
    processing_error: str | None = None,
    processing_job_id: str | None = None,
) -> dict[str, Any]:
    metadata = dict(file_row.get("metadata") or {})
    metadata["processing_status"] = processing_status
    if processing_error:
        metadata["processing_error"] = processing_error
    else:
        metadata.pop("processing_error", None)
    if processing_job_id:
        metadata["processing_job_id"] = processing_job_id

    payload = {
        "metadata": metadata,
        "processing_status": processing_status,
        "processing_error": processing_error,
        "processing_job_id": processing_job_id,
    }
    try:
        updated = await update_one("files", {"id": str(file_row["id"]), "user_id": user_id}, payload)
        return updated or {**file_row, **payload}
    except SupabaseServiceError:
        logger.warning("File processing columns are unavailable for Google Drive import; retrying metadata only.")
        updated = await update_one("files", {"id": str(file_row["id"]), "user_id": user_id}, {"metadata": metadata})
        return updated or {**file_row, "metadata": metadata}


@router.get("/connect")
async def connect_google_drive(request: Request, workspace_id: str | None = None, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    """Return the Google OAuth authorize URL for the client to redirect the user to."""
    user = current_user
    user_id = str(user.get("sub"))
    if workspace_id:
        await require_workspace_access(workspace_id, user_id)
    base = os.environ.get("OMNIX_BASE_URL") or "http://localhost:8000"
    redirect_uri = f"{base.rstrip('/')}/integrations/google_drive/callback"
    state = build_oauth_state(user_id, workspace_id)
    url = build_oauth_authorize_url(redirect_uri, state=state)
    return JSONResponse({"authorize_url": url})


# Exempted callback (no auth) will receive Google's redirect with code and state
@router.get("/callback")
async def oauth_callback(code: str | None = None, state: str | None = None) -> Any:
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code in callback")
    try:
        user_id, workspace_id = parse_oauth_state(state)
    except ValueError as exc:
        logger.warning("Rejected Google OAuth callback with invalid state: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state") from exc

    # Verify workspace access before storing tokens
    if workspace_id:
        access = await resolve_workspace_access(workspace_id, user_id)
        if access is None:
            params = urlencode({"status": "error", "detail": "workspace_access_denied"})
            return RedirectResponse(url=f"{os.environ.get('OMNIX_FRONTEND_URL','http://localhost:3000')}/integrations?{params}")

    base = os.environ.get("OMNIX_BASE_URL") or "http://localhost:8000"
    redirect_uri = f"{base.rstrip('/')}/integrations/google_drive/callback"

    try:
        tokens = await exchange_code_for_tokens(code, redirect_uri)
    except Exception as exc:
        logger.exception("Failed to exchange code for tokens: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Token exchange failed")

    try:
        await store_token_for_user(user_id, workspace_id, tokens)
    except Exception:
        logger.exception("Failed to persist google token")
        # Still redirect to frontend with error
        params = urlencode({"status": "error"})
        return RedirectResponse(url=f"{os.environ.get('OMNIX_FRONTEND_URL','http://localhost:3000')}/integrations?{params}")

    # Verify workspace membership if workspace_id was provided in the OAuth state
    if workspace_id:
        access = await resolve_workspace_access(workspace_id, user_id)
        if access is None:
            logger.warning(
                "OAuth callback rejected: user_id=%s is not a member of workspace_id=%s",
                user_id, workspace_id,
            )
            params = urlencode({"status": "error", "reason": "workspace_access_denied"})
            return RedirectResponse(url=f"{os.environ.get('OMNIX_FRONTEND_URL','http://localhost:3000')}/integrations?{params}")

    # Redirect user back to frontend integrations page
    params = urlencode({"status": "connected"})
    return RedirectResponse(url=f"{os.environ.get('OMNIX_FRONTEND_URL','http://localhost:3000')}/integrations?{params}")


@router.get("/files")
async def list_files(workspace_id: str | None = None, q: str | None = None, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
    if workspace_id:
        await require_workspace_access(workspace_id, user_id)
    token_row = await get_token_for_user(user_id, workspace_id)
    if not token_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google Drive not connected for this user/workspace")
    try:
        results = await list_drive_files_for_user(token_row, q=q)
        return results
    except Exception as exc:
        logger.exception("Failed to list drive files: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to list files")


@router.post("/import")
async def import_file(workspace_id: str, file_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
    await require_workspace_access(workspace_id, user_id)
    token_row = await get_token_for_user(user_id, workspace_id)
    if not token_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google Drive not connected for this user/workspace")

    # fetch file metadata first
    try:
        files_resp = await list_drive_files_for_user(token_row, q=f"'{file_id}' in parents or id = '{file_id}'", page_size=10)
        files = files_resp.get("files", [])
        file_meta = None
        for f in files:
            if f.get("id") == file_id:
                file_meta = f
                break
        if file_meta is None:
            # fallback: try fetching by id
            file_meta = {"id": file_id, "name": file_id, "mimeType": "text/plain"}
    except Exception:
        logger.exception("Failed to retrieve file metadata; proceeding with id only")
        file_meta = {"id": file_id, "name": file_id, "mimeType": "text/plain"}

    try:
        data = await download_drive_file_bytes(file_meta, token_row)
    except Exception as exc:
        logger.exception("Failed to download file bytes: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to download file")

    # Save through the same storage backend as direct uploads.
    filename = sanitize_filename(file_meta.get("name") or f"drive_{file_id}")
    try:
        storage_path = await save_bytes_to_user_upload(user_id, filename, data, content_type=file_meta.get("mimeType"))
    except Exception as exc:
        logger.exception("Failed to save downloaded file: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store file")

    # Persist file metadata
    processing_diagnostics = ExtractionDiagnostics(extraction_status="processing")
    payload = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "file_name": filename,
        "file_type": file_meta.get("mimeType"),
        "size_bytes": len(data),
        "storage_path": storage_path,
        "metadata": {
            "source": "google_drive",
            "drive_id": file_id,
            "processing_status": "uploaded",
            **processing_diagnostics.to_metadata(),
        },
        "processing_status": "uploaded",
        "processing_error": None,
        "processing_job_id": None,
        **extraction_columns_payload(processing_diagnostics),
    }
    try:
        file_row = await insert_one("files", payload)
    except SupabaseServiceError:
        logger.exception("Failed to persist file metadata")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to register file")

    try:
        job_id = await job_queue.enqueue_job(
            {
                "type": "ingest_file",
                "file_id": str(file_row.get("id")),
                "user_id": user_id,
                "workspace_id": workspace_id,
                "_queue": job_queue.ingestion_queue_for_file(filename, file_meta.get("mimeType")),
            }
        )
        file_row = await _update_import_processing_state(
            file_row,
            user_id=user_id,
            processing_status="queued",
            processing_job_id=job_id,
        )
    except job_queue.JobEnqueueError as exc:
        if exc.persisted:
            file_row = await _update_import_processing_state(
                file_row,
                user_id=user_id,
                processing_status="queued",
                processing_error="Background processing was queued, but the worker queue is temporarily unavailable.",
                processing_job_id=exc.job_id,
            )
        else:
            logger.exception("Failed to persist Google Drive ingestion job for file %s.", file_row.get("id"))
            file_row = await _update_import_processing_state(
                file_row,
                user_id=user_id,
                processing_status="failed",
                processing_error="File processing could not be queued. Please retry the import.",
            )
    except Exception:
        logger.exception("Failed to enqueue Google Drive ingestion job for file %s.", file_row.get("id"))
        file_row = await _update_import_processing_state(
            file_row,
            user_id=user_id,
            processing_status="failed",
            processing_error="File processing could not be queued. Please retry the import.",
        )

    return {"status": "imported", "processing_status": file_row.get("processing_status"), "file": file_row}
