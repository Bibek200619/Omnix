from __future__ import annotations

import os
import logging
import time
from typing import Any

import httpx

from ..services.supabase_service import (
    insert_one_trusted,
    select_one_trusted,
    update_one_trusted,
)

logger = logging.getLogger(__name__)

GOOGLE_OAUTH_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_OAUTH_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"
GOOGLE_DRIVE_EXPORT = "https://www.googleapis.com/drive/v3/files/{file_id}/export"
GOOGLE_DRIVE_DOWNLOAD = "https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
]


def _client_credentials() -> tuple[str, str]:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("Google OAuth client_id/secret not configured in environment")
    return client_id, client_secret


def build_oauth_authorize_url(redirect_uri: str, state: str | None = None) -> str:
    client_id, _ = _client_credentials()
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    }
    if state:
        params["state"] = state
    query = "&".join([f"{k}={httpx.utils.quote(str(v))}" for k, v in params.items()])
    return f"{GOOGLE_OAUTH_AUTHORIZE}?{query}"


async def exchange_code_for_tokens(code: str, redirect_uri: str) -> dict[str, Any]:
    client_id, client_secret = _client_credentials()
    data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_OAUTH_TOKEN, data=data, timeout=30)
    resp.raise_for_status()
    token_response = resp.json()
    # Normalize expiry
    expires_in = int(token_response.get("expires_in") or 0)
    token_response["expires_at"] = int(time.time()) + expires_in if expires_in else None
    return token_response


async def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    client_id, client_secret = _client_credentials()
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_OAUTH_TOKEN, data=data, timeout=30)
    resp.raise_for_status()
    token_response = resp.json()
    expires_in = int(token_response.get("expires_in") or 0)
    token_response["expires_at"] = int(time.time()) + expires_in if expires_in else None
    return token_response


async def ensure_valid_token(row: dict[str, Any]) -> dict[str, Any]:
    """Ensure access_token is valid; refresh if expired."""
    if not row:
        raise RuntimeError("No token row provided")
    expires_at = row.get("expires_at")
    if expires_at and int(time.time()) < int(expires_at) - 30:
        return row
    # Try refresh
    refresh_token = row.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("No refresh token available; reauthorization required")
    try:
        new = await refresh_access_token(refresh_token)
    except Exception as exc:
        logger.exception("Failed to refresh google token: %s", exc)
        raise
    # Persist new tokens
    try:
        await update_one_trusted("google_drive_tokens", {"id": row.get("id")}, {"access_token": new.get("access_token"), "expires_at": new.get("expires_at"), "updated_at": None})
    except Exception:
        logger.exception("Failed to persist refreshed token")
    row["access_token"] = new.get("access_token")
    row["expires_at"] = new.get("expires_at")
    return row


async def list_drive_files_for_user(token_row: dict[str, Any], q: str | None = None, page_size: int = 50) -> dict[str, Any]:
    row = await ensure_valid_token(token_row)
    access = row.get("access_token")
    params = {
        "pageSize": page_size,
        "fields": "nextPageToken, files(id,name,mimeType,modifiedTime,size,owners)",
        "q": q or None,
    }
    # Remove None values
    params = {k: v for k, v in params.items() if v is not None}
    headers = {"Authorization": f"Bearer {access}"}
    async with httpx.AsyncClient() as client:
        resp = await client.get(GOOGLE_DRIVE_FILES, params=params, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


async def download_drive_file_bytes(file_meta: dict[str, Any], token_row: dict[str, Any]) -> bytes:
    """Download file bytes. Supports Google Docs export and regular files."""
    row = await ensure_valid_token(token_row)
    access = row.get("access_token")
    headers = {"Authorization": f"Bearer {access}"}
    mime = (file_meta.get("mimeType") or "")
    file_id = file_meta.get("id")

    async with httpx.AsyncClient() as client:
        if mime == "application/vnd.google-apps.document":
            # export as plain text
            url = GOOGLE_DRIVE_EXPORT.format(file_id=file_id)
            resp = await client.get(url, params={"mimeType": "text/plain"}, headers=headers, timeout=60)
        else:
            url = GOOGLE_DRIVE_DOWNLOAD.format(file_id=file_id)
            resp = await client.get(url, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.content


async def store_token_for_user(user_id: str, workspace_id: str | None, token_response: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "provider": "google_drive",
        "access_token": token_response.get("access_token"),
        "refresh_token": token_response.get("refresh_token"),
        "scope": token_response.get("scope"),
        "expires_at": token_response.get("expires_at"),
    }
    row = await insert_one_trusted("google_drive_tokens", payload)
    return row


async def get_token_for_user(user_id: str, workspace_id: str | None = None) -> dict[str, Any] | None:
    filters = {"user_id": user_id}
    if workspace_id:
        filters["workspace_id"] = workspace_id
    rows = await select_one_trusted("google_drive_tokens", "id,user_id,workspace_id,access_token,refresh_token,expires_at,scope", filters)
    return rows
