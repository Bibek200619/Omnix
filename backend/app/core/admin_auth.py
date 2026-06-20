from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from fastapi import Depends, HTTPException, status

from .security import get_current_user
from ..services.supabase_service import SupabaseServiceError, select_all_trusted

PLATFORM_ADMIN_ROLES = {"admin", "founder", "owner", "super_founder"}
WORKSPACE_RUNTIME_ADMIN_ROLES = {"founder", "owner", "super_founder"}
WORKSPACE_MEMBER_ADMIN_COLUMNS = "workspace_id,user_id,role"


def _iter_role_values(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, Mapping):
        for key in ("role", "roles", "app_role", "app_roles"):
            yield from _iter_role_values(value.get(key))
        return
    if isinstance(value, Iterable):
        for item in value:
            yield from _iter_role_values(item)


def _normalized_roles_from_claims(current_user: Mapping[str, Any]) -> set[str]:
    roles: set[str] = set()
    for key in ("role", "roles", "app_role", "app_roles", "app_metadata", "user_metadata"):
        for role in _iter_role_values(current_user.get(key)):
            normalized = role.strip().lower().replace("-", "_")
            if normalized:
                roles.add(normalized)
    return roles


def _authenticated_user_id(current_user: Mapping[str, Any]) -> str | None:
    for key in ("sub", "id", "user_id"):
        value = current_user.get(key)
        if value is None:
            continue
        user_id = str(value).strip()
        if user_id and user_id.lower() != "none":
            return user_id
    return None


async def _has_workspace_runtime_admin_membership(user_id: str) -> bool:
    memberships = await select_all_trusted(
        "workspace_members",
        WORKSPACE_MEMBER_ADMIN_COLUMNS,
        filters={"user_id": user_id, "role": list(WORKSPACE_RUNTIME_ADMIN_ROLES)},
        limit=1,
    )
    return bool(memberships)


async def require_runtime_admin(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Require platform/runtime admin authority for operational admin endpoints."""
    roles = _normalized_roles_from_claims(current_user)
    if roles & PLATFORM_ADMIN_ROLES:
        return current_user

    user_id = _authenticated_user_id(current_user)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to resolve authenticated user",
        )

    try:
        if await _has_workspace_runtime_admin_membership(user_id):
            return current_user
    except SupabaseServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to verify runtime admin authorization.",
        ) from exc

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Runtime admin access is required.",
    )
