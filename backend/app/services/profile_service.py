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

PROFILE_TABLE = "profiles"
PROFILE_ID_COLUMN = "id"
BASE_USER_PROFILE_COLUMNS = "id,name,username,avatar_url,created_at,updated_at"
USER_PROFILE_COLUMNS = f"{BASE_USER_PROFILE_COLUMNS},phone_number"
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,29}$")
PHONE_NUMBER_RE = re.compile(r"^\+?[1-9]\d{6,19}$")
AVATAR_DATA_URL_RE = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$")
PROFILE_TIMESTAMP_COLUMNS = {"created_at", "updated_at"}


@dataclass(slots=True)
class AuthUserProfile:
    email: str | None
    name: str | None
    avatar_url: str | None
    username: str | None
    phone_number: str | None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_username(value: str | None) -> str | None:
    if value is None:
        return None
    username = value.strip().lower()
    if username.startswith("@"):
        username = username[1:]
    return username or None


def validate_username(value: str | None) -> str | None:
    username = normalize_username(value)
    if username is None:
        return None
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be 3-30 characters and use lowercase letters, numbers, hyphens, or underscores.",
        )
    return username


def normalize_phone_number(value: str | None) -> str | None:
    if value is None:
        return None
    phone_number = re.sub(r"[\s().-]+", "", value.strip())
    return phone_number or None


def validate_phone_number(value: str | None) -> str | None:
    phone_number = normalize_phone_number(value)
    if phone_number is None:
        return None
    if not PHONE_NUMBER_RE.fullmatch(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number must be 7-20 digits and may start with +.",
        )
    return phone_number


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


def _is_missing_supabase_column(exc: SupabaseServiceError, column: str) -> bool:
    root_error = exc.__cause__ or exc
    message = str(root_error).lower()
    normalized_column = column.lower()
    return normalized_column in message and (
        "could not find" in message
        or "does not exist" in message
        or "schema cache" in message
    )


def _has_missing_profile_timestamp(exc: SupabaseServiceError) -> bool:
    return any(_is_missing_supabase_column(exc, column) for column in PROFILE_TIMESTAMP_COLUMNS)


def _has_missing_profile_phone_number(exc: SupabaseServiceError) -> bool:
    return _is_missing_supabase_column(exc, "phone_number")


def _is_unique_profile_violation(exc: SupabaseServiceError) -> bool:
    message = str(exc.__cause__ or exc).lower()
    return "duplicate" in message or "unique" in message


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
    name = metadata.get("full_name") or metadata.get("name")
    avatar_url = metadata.get("avatar_url") or metadata.get("picture")
    username = metadata.get("username")
    phone_number = metadata.get("phone_number") or metadata.get("phone")
    return AuthUserProfile(
        email=user_email_from_claims(current_user),
        name=name.strip() if isinstance(name, str) and name.strip() else None,
        avatar_url=avatar_url.strip() if isinstance(avatar_url, str) and avatar_url.strip() else None,
        username=normalize_username(username) if isinstance(username, str) else None,
        phone_number=normalize_phone_number(phone_number) if isinstance(phone_number, str) else None,
    )


def _auth_profile_for_user_sync(user_id: str) -> AuthUserProfile:
    try:
        user_response = get_supabase().auth.admin.get_user_by_id(user_id)
        user = getattr(user_response, "user", None)
    except Exception:
        logger.exception("Failed to resolve auth profile for %s.", user_id)
        return AuthUserProfile(email=None, name=None, avatar_url=None, username=None, phone_number=None)

    metadata = getattr(user, "user_metadata", None) or {}
    name = None
    avatar_url = None
    username = None
    phone_number = None
    if isinstance(metadata, Mapping):
        name = metadata.get("full_name") or metadata.get("name")
        avatar_url = metadata.get("avatar_url") or metadata.get("picture")
        username = metadata.get("username")
        phone_number = metadata.get("phone_number") or metadata.get("phone")

    return AuthUserProfile(
        email=getattr(user, "email", None),
        name=name.strip() if isinstance(name, str) and name.strip() else None,
        avatar_url=avatar_url.strip() if isinstance(avatar_url, str) and avatar_url.strip() else None,
        username=normalize_username(username) if isinstance(username, str) else None,
        phone_number=normalize_phone_number(phone_number) if isinstance(phone_number, str) else None,
    )


async def get_auth_profile_for_user(user_id: str) -> AuthUserProfile:
    return await run_in_threadpool(_auth_profile_for_user_sync, user_id)


def _merge_profile(row: dict[str, Any] | None, auth_profile: AuthUserProfile, user_id: str) -> dict[str, Any]:
    row = dict(row or {})
    profile_id = row.get(PROFILE_ID_COLUMN) or user_id
    username = row.get("username") or auth_profile.username
    return {
        "user_id": str(profile_id),
        "email": auth_profile.email,
        "username": username,
        "display_name": row.get("name") or auth_profile.name,
        "phone_number": row.get("phone_number") or auth_profile.phone_number,
        "avatar_url": row.get("avatar_url") or auth_profile.avatar_url,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def _insert_user_profile(payload: Mapping[str, Any]) -> dict[str, Any]:
    try:
        return await insert_one_trusted(PROFILE_TABLE, payload)
    except SupabaseServiceError as exc:
        if not (_has_missing_profile_timestamp(exc) or _has_missing_profile_phone_number(exc)):
            raise

        logger.warning(
            "profiles schema is behind; creating profile without unavailable columns | id=%s",
            payload.get(PROFILE_ID_COLUMN),
        )
        unavailable_columns: set[str] = set()
        if _has_missing_profile_timestamp(exc):
            unavailable_columns.update(PROFILE_TIMESTAMP_COLUMNS)
        if _has_missing_profile_phone_number(exc):
            unavailable_columns.add("phone_number")
        fallback_payload = {key: value for key, value in payload.items() if key not in unavailable_columns}
        return await insert_one_trusted(PROFILE_TABLE, fallback_payload)


async def _select_user_profile(filters: dict[str, Any]) -> dict[str, Any] | None:
    try:
        return await select_one_trusted(PROFILE_TABLE, USER_PROFILE_COLUMNS, filters)
    except SupabaseServiceError as exc:
        if not _has_missing_profile_phone_number(exc):
            raise
        logger.warning("profiles.phone_number is unavailable; loading profile without it.")
        return await select_one_trusted(PROFILE_TABLE, BASE_USER_PROFILE_COLUMNS, filters)


async def ensure_user_profile(current_user: Any) -> dict[str, Any]:
    user_id = user_id_from_claims(current_user)
    auth_profile = _metadata_profile(current_user)

    try:
        existing = await _select_user_profile({PROFILE_ID_COLUMN: user_id})
    except SupabaseServiceError as exc:
        logger.exception("Failed to load user profile | user_id=%s", user_id)
        raise HTTPException(status_code=500, detail="Internal server error") from exc

    if existing is not None:
        return _merge_profile(existing, auth_profile, user_id)

    timestamp = utc_now_iso()
    username = None
    try:
        username = validate_username(auth_profile.username)
    except HTTPException:
        username = None

    payload = {
        PROFILE_ID_COLUMN: user_id,
        "username": username,
        "name": auth_profile.name,
        "phone_number": auth_profile.phone_number,
        "avatar_url": validate_avatar_url(auth_profile.avatar_url),
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    try:
        created = await _insert_user_profile(payload)
    except SupabaseServiceError:
        fallback_payload = {**payload, "username": None}
        try:
            created = await _insert_user_profile(fallback_payload)
        except SupabaseServiceError as exc:
            logger.exception("Failed to create user profile | user_id=%s", user_id)
            raise HTTPException(status_code=500, detail="Internal server error") from exc

    return _merge_profile(created, auth_profile, user_id)


async def update_user_profile(current_user: Any, payload: Mapping[str, Any]) -> dict[str, Any]:
    user_id = user_id_from_claims(current_user)
    updates: dict[str, Any] = {"updated_at": utc_now_iso()}
    username_value = payload.get("username")

    current = await ensure_user_profile(current_user)

    if "display_name" in payload and payload["display_name"] is not None:
        name = str(payload["display_name"]).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Display name cannot be empty.")
        updates["name"] = name

    if payload.get("remove_avatar"):
        updates["avatar_url"] = None
    elif "avatar_url" in payload:
        updates["avatar_url"] = validate_avatar_url(payload.get("avatar_url"))

    if "phone_number" in payload:
        updates["phone_number"] = validate_phone_number(str(payload.get("phone_number") or ""))

    if username_value is not None:
        next_username = validate_username(str(username_value))
        current_username = normalize_username(current.get("username"))
        if current_username and next_username != current_username:
            raise HTTPException(status_code=400, detail="Username is already set and cannot be changed.")
        if not current_username:
            existing = await _select_user_profile({"username": next_username})
            if existing is not None and str(existing.get(PROFILE_ID_COLUMN)) != user_id:
                raise HTTPException(status_code=409, detail="That username is already taken.")
            updates["username"] = next_username

    try:
        updated = await update_one_trusted(PROFILE_TABLE, {PROFILE_ID_COLUMN: user_id}, updates)
    except SupabaseServiceError as exc:
        if _is_unique_profile_violation(exc):
            raise HTTPException(status_code=409, detail="That username is already taken.") from exc

        if _is_missing_supabase_column(exc, "updated_at") or _has_missing_profile_phone_number(exc):
            fallback_updates = {
                key: value
                for key, value in updates.items()
                if key != "updated_at" and key != "phone_number"
            }
            if not fallback_updates:
                logger.warning(
                    "profiles schema is behind and no compatible profile fields changed | user_id=%s",
                    user_id,
                )
                return current

            logger.warning(
                "profiles schema is behind; updating profile without unavailable columns | user_id=%s",
                user_id,
            )
            try:
                updated = await update_one_trusted(PROFILE_TABLE, {PROFILE_ID_COLUMN: user_id}, fallback_updates)
            except SupabaseServiceError as fallback_exc:
                if _is_unique_profile_violation(fallback_exc):
                    raise HTTPException(status_code=409, detail="That username is already taken.") from fallback_exc
                logger.exception("Failed to update user profile | user_id=%s", user_id)
                raise HTTPException(status_code=500, detail="Internal server error") from fallback_exc
        else:
            logger.exception("Failed to update user profile | user_id=%s", user_id)
            raise HTTPException(status_code=500, detail="Internal server error") from exc

    return _merge_profile(updated, _metadata_profile(current_user), user_id)


async def get_user_profile_map(user_ids: list[str]) -> dict[str, dict[str, Any]]:
    ids = sorted({user_id for user_id in user_ids if user_id})
    if not ids:
        return {}

    try:
        rows = await select_all_trusted(PROFILE_TABLE, USER_PROFILE_COLUMNS, filters={PROFILE_ID_COLUMN: ids})
    except SupabaseServiceError as exc:
        if not _has_missing_profile_phone_number(exc):
            logger.exception("Failed to load app profiles for workspace members.")
            return {}
        try:
            rows = await select_all_trusted(PROFILE_TABLE, BASE_USER_PROFILE_COLUMNS, filters={PROFILE_ID_COLUMN: ids})
        except SupabaseServiceError:
            logger.exception("Failed to load app profiles for workspace members.")
            return {}

    profile_map: dict[str, dict[str, Any]] = {}
    empty_auth_profile = AuthUserProfile(email=None, name=None, avatar_url=None, username=None, phone_number=None)
    for row in rows:
        profile_id = row.get(PROFILE_ID_COLUMN)
        if profile_id:
            profile_map[str(profile_id)] = {
                **_merge_profile(row, empty_auth_profile, str(profile_id)),
                "name": row.get("name"),
            }
    return profile_map


async def resolve_profile_by_username(username: str) -> dict[str, Any] | None:
    normalized = validate_username(username)
    try:
        return await _select_user_profile({"username": normalized})
    except SupabaseServiceError as exc:
        raise HTTPException(status_code=500, detail="Internal server error") from exc
