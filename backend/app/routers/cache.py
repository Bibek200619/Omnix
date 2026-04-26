from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from ..schemas.chat import CacheCreate, CacheRead
from ..services.supabase_service import SupabaseServiceError, select_one, upsert_one

router = APIRouter(prefix="/cache", tags=["cache"])
CACHE_COLUMNS = "id,user_id,cache_key,value,created_at,updated_at"

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


@router.post("", response_model=CacheRead)
async def set_cache(
    payload: CacheCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)

    try:
        return await upsert_one(
            "cache",
            {
                "user_id": user_id,
                "cache_key": payload.cache_key,
                "value": payload.value,
                "updated_at": _utc_now_iso(),
            },
            on_conflict="user_id,cache_key",
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc


@router.get("/{cache_key}", response_model=CacheRead)
async def get_cache(
    cache_key: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)

    try:
        cache_entry = await select_one(
            "cache",
            CACHE_COLUMNS,
            {"user_id": user_id, "cache_key": cache_key},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if cache_entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cache entry not found.",
        )
    return cache_entry
