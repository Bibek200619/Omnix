from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import re
from typing import Any

from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..db.supabase_client import get_supabase
from .supabase_service import (
    SupabaseServiceError,
    insert_one_trusted,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)

logger = logging.getLogger(__name__)

USER_PROFILE_COLUMNS = "user_id,handle,display_name,avatar_url,created_at,updated_at"
HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,29}$")
AVATAR_DATA_URL_RE = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$")


@dataclass(slots=True)
class AuthUserProfile:
    email: str | None
    display_name: str | None
    avatar_url: str | None
    handle: str | None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_handle(value: str | None) -> str | None:
    if value is None:
        return None
    handle = value.strip().lower()
    if handle.startswith("@"):
        handle = handle[1:]
    return handle or None


def validate_handle(value: str | None) -> str | None:
    handle = normalize_handle(value)
    if handle is None:
        return None
    if not HANDLE_RE.fullmatch(handle):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Handle must be 3-30 characters and use lowercase letters, numbers, hyphens, or underscores.",
        )
    return handle


def validate_avatar_url(value: str | None) -> str | None:
    if value is None:
        return None
    avatar_url = value.strip()
    if not avatar_url:
        return None
    if avatar_url.startswith("https://") or avatar_url.startswith("http://"):
        return avatar_url
    if AVATAR_DATA_URL_RE.fullmatch(avatar_url):
        return avatar_url
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Avatar must be an image data URL or http(s) URL.",
    )


def user_id_from_claims(current_user: Any) -> str:
    for key in ("id", "user_id", "sub"):
        value = (
            current_user.get(key)
            if isinstance(current_user, Mapping)
            else getattr(current_user, key, None)
        )
        if value:
            return str(value)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unable to resolve authenticated user",
    )


def user_email_from_claims(current_user: Any) -> str | None:
    email = (
        current_user.get("email")
        if isinstance(current_user, Mapping)
        else getattr(current_user, "email", None)
    )
    if isinstance(email, str) and email.strip():
        return email.strip().lower()
    return None


def _metadata_from_claims(current_user: Any) -> Mapping[str, Any]:
    for key in ("user_metadata", "raw_user_meta_data"):
        value = (
            current_user.get(key)
            if isinstance(current_user, Mapping)
            else getattr(current_user, key, None)
        )
        if isinstance(value, Mapping):
            return value
    return {}


def _metadata_profile(current_user: Any) -> AuthUserProfile:
    metadata = _metadata_from_claims(current_user)
    display_name = metadata.get("full_name") or metadata.get("name")
    avatar_url = metadata.get("avatar_url") or metadata.get("picture")
    handle = metadata.get("handle") or metadata.get("username")
    return AuthUserProfile(
        email=user_email_from_claims(current_user),
        display_name=display_name.strip() if isinstance(display_name, str) and display_name.strip() else None,
        avatar_url=avatar_url.strip() if isinstance(avatar_url, str) and avatar_url.strip() else None,
        handle=normalize_handle(handle) if isinstance(handle, str) else None,
    )


def _auth_profile_for_user_sync(user_id: str) -> AuthUserProfile:
    try:
        user_response = get_supabase().auth.admin.get_user_by_id(user_id)
        user = getattr(user_response, "user", None)
    except Exception:
        logger.exception("Failed to resolve auth profile for %s.", user_id)
        return AuthUserProfile(email=None, display_name=None, avatar_url=None, handle=None)

    metadata = getattr(user, "user_metadata", None) or {}
    display_name = None
    avatar_url = None
    handle = None
    if isinstance(metadata, Mapping):
        display_name = metadata.get("full_name") or metadata.get("name")
        avatar_url = metadata.get("avatar_url") or metadata.get("picture")
        handle = metadata.get("handle") or metadata.get("username")

    return AuthUserProfile(
        email=getattr(user, "email", None),
        display_name=display_name.strip() if isinstance(display_name, str) and display_name.strip() else None,
        avatar_url=avatar_url.strip() if isinstance(avatar_url, str) and avatar_url.strip() else None,
        handle=normalize_handle(handle) if isinstance(handle, str) else None,
    )


async def get_auth_profile_for_user(user_id: str) -> AuthUserProfile:
    return await run_in_threadpool(_auth_profile_for_user_sync, user_id)


def _merge_profile(row: dict[str, Any] | None, auth_profile: AuthUserProfile, user_id: str) -> dict[str, Any]:
    row = dict(row or {})
    handle = row.get("handle") or auth_profile.handle
    return {
        "user_id": user_id,
        "email": auth_profile.email,
        "handle": handle,
        "username": handle,
        "display_name": row.get("display_name") or auth_profile.display_name,
        "avatar_url": row.get("avatar_url") or auth_profile.avatar_url,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def ensure_user_profile(current_user: Any) -> dict[str, Any]:
    user_id = user_id_from_claims(current_user)
    auth_profile = _metadata_profile(current_user)

    try:
        existing = await select_one_trusted("user_profiles", USER_PROFILE_COLUMNS, {"user_id": user_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to load user profile | user_id=%s", user_id)
        raise HTTPException(status_code=500, detail="Internal server error") from exc

    if existing is not None:
        return _merge_profile(existing, auth_profile, user_id)

    timestamp = utc_now_iso()
    handle = None
    try:
        handle = validate_handle(auth_profile.handle)
    except HTTPException:
        handle = None

    payload = {
        "user_id": user_id,
        "handle": handle,
        "display_name": auth_profile.display_name,
        "avatar_url": validate_avatar_url(auth_profile.avatar_url),
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    try:
        created = await insert_one_trusted("user_profiles", payload)
    except SupabaseServiceError:
        fallback_payload = {**payload, "handle": None}
        created = await insert_one_trusted("user_profiles", fallback_payload)

    return _merge_profile(created, auth_profile, user_id)


async def update_user_profile(current_user: Any, payload: Mapping[str, Any]) -> dict[str, Any]:
    user_id = user_id_from_claims(current_user)
    updates: dict[str, Any] = {"updated_at": utc_now_iso()}
    handle_value = payload.get("username") if "username" in payload else payload.get("handle")

    if "username" in payload and "handle" in payload:
        username = normalize_handle(str(payload["username"])) if payload["username"] is not None else None
        handle = normalize_handle(str(payload["handle"])) if payload["handle"] is not None else None
        if username != handle:
            raise HTTPException(status_code=400, detail="Username and handle must match when both are provided.")

    current = await ensure_user_profile(current_user)

    if "display_name" in payload and payload["display_name"] is not None:
        display_name = str(payload["display_name"]).strip()
        if not display_name:
            raise HTTPException(status_code=400, detail="Display name cannot be empty.")
        updates["display_name"] = display_name

    if payload.get("remove_avatar"):
        updates["avatar_url"] = None
    elif "avatar_url" in payload:
        updates["avatar_url"] = validate_avatar_url(payload.get("avatar_url"))

    if handle_value is not None:
        next_handle = validate_handle(str(handle_value))
        current_handle = normalize_handle(current.get("handle"))
        if current_handle and next_handle != current_handle:
            raise HTTPException(status_code=400, detail="Handle is already set and cannot be changed.")
        if not current_handle:
            existing = await select_one_trusted("user_profiles", USER_PROFILE_COLUMNS, {"handle": next_handle})
            if existing is not None and str(existing.get("user_id")) != user_id:
                raise HTTPException(status_code=409, detail="That handle is already taken.")
            updates["handle"] = next_handle

    try:
        updated = await update_one_trusted("user_profiles", {"user_id": user_id}, updates)
    except SupabaseServiceError as exc:
        message = str(exc.__cause__ or exc).lower()
        if "duplicate" in message or "unique" in message:
            raise HTTPException(status_code=409, detail="That handle is already taken.") from exc
        raise HTTPException(status_code=500, detail="Internal server error") from exc

    return _merge_profile(updated, _metadata_profile(current_user), user_id)


async def get_user_profile_map(user_ids: list[str]) -> dict[str, dict[str, Any]]:
    ids = sorted({user_id for user_id in user_ids if user_id})
    if not ids:
        return {}

    try:
        rows = await select_all_trusted(
            "user_profiles",
            USER_PROFILE_COLUMNS,
            filters={"user_id": ids},
        )
    except SupabaseServiceError:
        logger.exception("Failed to load app profiles for workspace members.")
        return {}

    return {str(row["user_id"]): row for row in rows if row.get("user_id")}


async def resolve_profile_by_handle(handle: str) -> dict[str, Any] | None:
    normalized = validate_handle(handle)
    try:
        return await select_one_trusted("user_profiles", USER_PROFILE_COLUMNS, {"handle": normalized})
    except SupabaseServiceError as exc:
        raise HTTPException(status_code=500, detail="Internal server error") from exc
