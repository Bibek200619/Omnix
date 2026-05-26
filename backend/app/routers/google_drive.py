from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse, JSONResponse

from ..core.security import get_current_user
from ..integrations.google_drive import (
    build_oauth_authorize_url,
    exchange_code_for_tokens,
    store_token_for_user,
    get_token_for_user,
    list_drive_files_for_user,
    download_drive_file_bytes,
)
from ..services.supabase_service import SupabaseServiceError, insert_one
from ..routers.upload import _save_bytes_to_path, _extract_text_from_bytes
from ..rag.ingestion import RAGIngestionPipeline
from ..rag.startup import get_vector_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/integrations/google_drive", tags=["integrations"])


@router.get("/connect")
async def connect_google_drive(request: Request, workspace_id: str | None = None, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    """Return the Google OAuth authorize URL for the client to redirect the user to."""
    user = current_user
    user_id = str(user.get("sub"))
    base = os.environ.get("OMNIX_BASE_URL") or "http://localhost:8000"
    redirect_uri = f"{base.rstrip('/')}/integrations/google_drive/callback"
    # encode state as user_id|workspace_id
    state = f"{user_id}|{workspace_id or ''}"
    url = build_oauth_authorize_url(redirect_uri, state=state)
    return JSONResponse({"authorize_url": url})


# Exempted callback (no auth) will receive Google's redirect with code and state
@router.get("/callback")
async def oauth_callback(code: str | None = None, state: str | None = None) -> Any:
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code in callback")
    # parse state
    user_id = None
    workspace_id = None
    if state:
        parts = state.split("|", 1)
        user_id = parts[0] if parts and parts[0] else None
        workspace_id = parts[1] if len(parts) > 1 and parts[1] else None

    base = os.environ.get("OMNIX_BASE_URL") or "http://localhost:8000"
    redirect_uri = f"{base.rstrip('/')}/integrations/google_drive/callback"

    try:
        tokens = await exchange_code_for_tokens(code, redirect_uri)
    except Exception as exc:
        logger.exception("Failed to exchange code for tokens: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Token exchange failed")

    if not user_id:
        # No user bound; return a simple success page
        return JSONResponse({"status": "connected", "detail": "No user state provided; tokens not stored."})

    try:
        await store_token_for_user(user_id, workspace_id, tokens)
    except Exception:
        logger.exception("Failed to persist google token")
        # Still redirect to frontend with error
        params = urlencode({"status": "error"})
        return RedirectResponse(url=f"{os.environ.get('OMNIX_FRONTEND_URL','http://localhost:3000')}/integrations?{params}")

    # Redirect user back to frontend integrations page
    params = urlencode({"status": "connected"})
    return RedirectResponse(url=f"{os.environ.get('OMNIX_FRONTEND_URL','http://localhost:3000')}/integrations?{params}")


@router.get("/files")
async def list_files(workspace_id: str | None = None, q: str | None = None, current_user: dict[str, Any] = Depends(get_current_user)) -> Any:
    user_id = str(current_user.get("sub"))
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

    # Save to disk like upload flow
    filename = file_meta.get("name") or f"drive_{file_id}"
    try:
        storage_path = await _save_bytes_to_path(user_id, filename, data)
    except Exception as exc:
        logger.exception("Failed to save downloaded file: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store file")

    # Extract text using upload helpers
    try:
        text = _extract_text_from_bytes(filename, file_meta.get("mimeType"), data)
        normalized = "\n\n".join([line.strip() for line in text.splitlines() if line.strip()])
    except Exception:
        logger.exception("Text extraction failed; using raw bytes decode fallback")
        try:
            normalized = data.decode("utf-8", errors="ignore")
        except Exception:
            normalized = ""

    # Persist file metadata
    payload = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "file_name": filename,
        "file_type": file_meta.get("mimeType"),
        "size_bytes": len(data),
        "storage_path": storage_path,
        "metadata": {"source": "google_drive", "drive_id": file_id, "extracted_preview": normalized[:2000]},
    }
    try:
        file_row = await insert_one("files", payload)
    except SupabaseServiceError:
        logger.exception("Failed to persist file metadata")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to register file")

    # Ingest into RAG index
    try:
        vector_store = get_vector_store()
        pipeline = RAGIngestionPipeline(vector_store)
        await pipeline.ingest_text(normalized, user_id, document_id=file_row.get("id"), workspace_id=workspace_id)
    except Exception:
        logger.exception("Ingestion failed; continuing")

    return {"status": "imported", "file": file_row}
