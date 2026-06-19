from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status

from ..core.security import get_current_user
from ..schemas.connectors import ConnectorCreate, ConnectorRead
from ..services.workspace_connector_service import (
    create_workspace_connector,
    delete_workspace_connector,
    list_workspace_connectors,
    retry_workspace_connector,
)
from ..services.workspace_service import active_workspace_id_from_request

router = APIRouter(prefix="/connectors", tags=["connectors"])


def _user_id_from_claims(current_user: dict[str, Any]) -> str:
    return str(current_user["sub"])


@router.get("", response_model=list[ConnectorRead])
async def get_connectors(
    request: Request,
    workspace_id: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    user_id = _user_id_from_claims(current_user)
    effective_workspace_id = workspace_id or active_workspace_id_from_request(request)
    if not effective_workspace_id:
        return []
    return await list_workspace_connectors(effective_workspace_id, user_id)


@router.post("", response_model=ConnectorRead, status_code=status.HTTP_201_CREATED)
async def create_connector(
    payload: ConnectorCreate,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await create_workspace_connector(
        payload,
        user_id,
        active_workspace_id_from_request(request),
    )


@router.post("/{connector_id}/retry", response_model=ConnectorRead)
async def retry_connector(
    connector_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = _user_id_from_claims(current_user)
    return await retry_workspace_connector(connector_id, user_id)


@router.delete("/{connector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connector(
    connector_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    user_id = _user_id_from_claims(current_user)
    await delete_workspace_connector(connector_id, user_id)
