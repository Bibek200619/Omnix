from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from ..dependencies import get_current_user
from ..schemas.continuity import (
    WorkspaceInitiativeCreate,
    WorkspaceInitiativeResponse,
    WorkspaceOperationalTimelineEvent
)
from ..services.workspace_continuity_service import (
    create_initiative,
    list_initiatives,
    get_continuity_timeline,
    list_unresolved_continuity
)

router = APIRouter(prefix="/workspaces", tags=["continuity"])

@router.post("/{workspace_id}/initiatives", response_model=WorkspaceInitiativeResponse)
async def create_workspace_initiative(
    workspace_id: UUID,
    payload: WorkspaceInitiativeCreate,
    user: dict = Depends(get_current_user),
):
    try:
        return await create_initiative(
            user_id=UUID(user["id"]),
            workspace_id=workspace_id,
            name=payload.name,
            description=payload.description,
            metadata=payload.metadata
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{workspace_id}/initiatives", response_model=List[WorkspaceInitiativeResponse])
async def get_workspace_initiatives(
    workspace_id: UUID,
    initiative_status: Optional[str] = Query(None, description="Filter by status (active, paused, completed)"),
    user: dict = Depends(get_current_user),
):
    try:
        return await list_initiatives(
            user_id=UUID(user["id"]),
            workspace_id=workspace_id,
            status=initiative_status
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{workspace_id}/timeline", response_model=List[WorkspaceOperationalTimelineEvent])
async def get_workspace_timeline(
    workspace_id: UUID,
    initiative_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    try:
        return await get_continuity_timeline(
            user_id=UUID(user["id"]),
            workspace_id=workspace_id,
            initiative_id=initiative_id,
            limit=limit
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{workspace_id}/continuity/unresolved", response_model=List[dict])
async def get_unresolved_continuity(
    workspace_id: UUID,
    user: dict = Depends(get_current_user),
):
    try:
        return await list_unresolved_continuity(
            user_id=UUID(user["id"]),
            workspace_id=workspace_id
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
