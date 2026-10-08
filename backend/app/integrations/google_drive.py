from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import logging
import time
from typing import Any
from urllib.parse import urlencode

from cryptography.fernet import Fernet, InvalidToken
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
DEFAULT_OAUTH_STATE_TTL_SECONDS = 10 * 60
TOKEN_CIPHERTEXT_PREFIX = "enc:v1:"

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


def _oauth_state_secret() -> str:
    secret = (
        os.environ.get("GOOGLE_OAUTH_STATE_SECRET")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE")
    )
    if not secret:
        raise RuntimeError("GOOGLE_OAUTH_STATE_SECRET or SUPABASE_SERVICE_ROLE_KEY must be configured")
    return secret


def _oauth_state_ttl_seconds() -> int:
    try:
        return max(60, int(os.environ.get("GOOGLE_OAUTH_STATE_TTL_SECONDS", DEFAULT_OAUTH_STATE_TTL_SECONDS)))
    except ValueError:
        logger.warning("Invalid GOOGLE_OAUTH_STATE_TTL_SECONDS; using default.")
        return DEFAULT_OAUTH_STATE_TTL_SECONDS


def _token_encryption_secret() -> str:
    secret = (
        os.environ.get("OMNIX_TOKEN_ENCRYPTION_KEY")
        or os.environ.get("GOOGLE_TOKEN_ENCRYPTION_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE")
    )
    if not secret:
        raise RuntimeError("OMNIX_TOKEN_ENCRYPTION_KEY or SUPABASE_SERVICE_ROLE_KEY must be configured")
    return secret


def _token_cipher() -> Fernet:
    digest = hashlib.sha256(_token_encryption_secret().encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt_token(value: Any) -> str | None:
    if value is None:
        return None
    token = str(value)
    if not token:
        return token
    if token.startswith(TOKEN_CIPHERTEXT_PREFIX):
        return token
    encrypted = _token_cipher().encrypt(token.encode("utf-8")).decode("ascii")
    return f"{TOKEN_CIPHERTEXT_PREFIX}{encrypted}"


def _decrypt_token(value: Any) -> str | None:
    if value is None:
        return None
    token = str(value)
    if not token.startswith(TOKEN_CIPHERTEXT_PREFIX):
        return token
    ciphertext = token[len(TOKEN_CIPHERTEXT_PREFIX) :]
    try:
        return _token_cipher().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored Google Drive token could not be decrypted") from exc


def _decrypt_token_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    decrypted = dict(row)
    decrypted["access_token"] = _decrypt_token(decrypted.get("access_token"))
    decrypted["refresh_token"] = _decrypt_token(decrypted.get("refresh_token"))
    return decrypted


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _base64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(f"{data}{padding}")


def _sign_oauth_state(payload_segment: str) -> str:
    digest = hmac.new(
        _oauth_state_secret().encode("utf-8"),
        payload_segment.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return _base64url_encode(digest)


def build_oauth_state(user_id: str, workspace_id: str | None) -> str:
    if not user_id or not str(user_id).strip():
        raise ValueError("user_id is required for OAuth state")
    payload = {
        "iat": int(time.time()),
        "sub": str(user_id),
        "workspace_id": str(workspace_id) if workspace_id else None,
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_segment = _base64url_encode(payload_json)
    return f"{payload_segment}.{_sign_oauth_state(payload_segment)}"


def parse_oauth_state(state: str | None) -> tuple[str, str | None]:
    if not state or "." not in state:
        raise ValueError("Missing OAuth state")
    payload_segment, signature = state.rsplit(".", 1)
    expected_signature = _sign_oauth_state(payload_segment)
    if not hmac.compare_digest(signature, expected_signature):
        raise ValueError("Invalid OAuth state signature")

    try:
        payload = json.loads(_base64url_decode(payload_segment))
    except Exception as exc:
        raise ValueError("Invalid OAuth state payload") from exc

    issued_at = int(payload.get("iat") or 0)
    now = int(time.time())
    ttl_seconds = _oauth_state_ttl_seconds()
    if issued_at <= 0 or issued_at < now - ttl_seconds or issued_at > now + 60:
        raise ValueError("Expired OAuth state")

    user_id = str(payload.get("sub") or "").strip()
    if not user_id:
        raise ValueError("OAuth state is missing user")
    workspace_id = payload.get("workspace_id")
    return user_id, str(workspace_id) if workspace_id else None


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
    query = urlencode(params)
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
    row = _decrypt_token_row(row) or row
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
        await update_one_trusted(
            "google_drive_tokens",
            {"id": row.get("id")},
            {
                "access_token": _encrypt_token(new.get("access_token")),
                "expires_at": new.get("expires_at"),
                "updated_at": None,
            },
        )
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
        "access_token": _encrypt_token(token_response.get("access_token")),
        "refresh_token": _encrypt_token(token_response.get("refresh_token")),
        "scope": token_response.get("scope"),
        "expires_at": token_response.get("expires_at"),
    }
    row = await insert_one_trusted("google_drive_tokens", payload)
    return row


async def get_token_for_user(
    user_id: str, workspace_id: str | None = None
) -> dict[str, Any] | None:
    filters = {
        "user_id": user_id,
        "workspace_id": workspace_id if workspace_id else {"is": None},
    }
    rows = await select_one_trusted(
        "google_drive_tokens",
        "id,user_id,workspace_id,access_token,refresh_token,expires_at,scope",
        filters,
    )
    return _decrypt_token_row(rows)
