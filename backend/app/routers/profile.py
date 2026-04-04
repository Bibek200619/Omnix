from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, status

from ..core.security import get_current_user
from ..schemas.profile import UserProfileRead, UserProfileUpdate
from ..services.profile_service import ensure_user_profile, update_user_profile

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=UserProfileRead, status_code=status.HTTP_200_OK)
@router.get("/", response_model=UserProfileRead, status_code=status.HTTP_200_OK, include_in_schema=False)
async def get_profile(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return await ensure_user_profile(current_user)


@router.patch("", response_model=UserProfileRead, status_code=status.HTTP_200_OK)
@router.patch("/", response_model=UserProfileRead, status_code=status.HTTP_200_OK, include_in_schema=False)
async def patch_profile(
    profile_payload: UserProfileUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await update_user_profile(
        current_user,
        profile_payload.model_dump(exclude_unset=True),
    )
