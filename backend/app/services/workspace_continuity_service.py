from typing import Any, List, Optional
import logging
from uuid import UUID
from datetime import datetime

from .supabase_service import (
    select_all_trusted, 
    insert_one_trusted, 
    update_one_trusted,
    SupabaseServiceError
)
from .workspace_service import require_workspace_access

logger = logging.getLogger(__name__)

async def create_initiative(
    user_id: UUID,
    workspace_id: UUID,
    name: str,
    description: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Create a new operational initiative, tracking continuity in a workspace."""
    # Validate access
    await require_workspace_access(user_id, workspace_id, ["founder", "super_founder", "owner", "co_owner", "sub_leader", "member", "sub_member"])

    data = {
        "workspace_id": str(workspace_id),
        "name": name,
        "description": description,
        "status": "active",
        "momentum_score": 1.0,
        "metadata": metadata or {},
    }
    
    try:
        initiative = await insert_one_trusted("workspace_initiatives", data)
        
        # Log to operational timeline
        timeline_data = {
            "workspace_id": str(workspace_id),
            "initiative_id": initiative["id"],
            "event_type": "initiative_started",
            "summary": f"Initiative '{name}' started.",
            "metadata": {"actor_user_id": str(user_id)}
        }
        await insert_one_trusted("workspace_operational_timeline", timeline_data)
        
        return initiative
    except SupabaseServiceError as exc:
        logger.error("Failed to create initiative: %s", exc)
        raise ValueError(f"Failed to create initiative: {exc}")

async def list_initiatives(
    user_id: UUID,
    workspace_id: UUID,
    status: Optional[str] = None
) -> list[dict[str, Any]]:
    """List initiatives for a workspace."""
    await require_workspace_access(user_id, workspace_id)

    filters = {"workspace_id": str(workspace_id)}
    if status:
        filters["status"] = status
    
    try:
        return await select_all_trusted(
            "workspace_initiatives",
            "*",
            filters=filters,
            order_by="updated_at",
            desc=True
        )
    except SupabaseServiceError as exc:
        logger.error("Failed to list initiatives: %s", exc)
        return []

async def get_continuity_timeline(
    user_id: UUID,
    workspace_id: UUID,
    initiative_id: Optional[UUID] = None,
    limit: int = 50
) -> list[dict[str, Any]]:
    """Retrieve operational timeline events for a workspace or initiative."""
    await require_workspace_access(user_id, workspace_id)

    filters = {"workspace_id": str(workspace_id)}
    if initiative_id:
        filters["initiative_id"] = str(initiative_id)
    
    try:
        return await select_all_trusted(
            "workspace_operational_timeline",
            "*",
            filters=filters,
            order_by="created_at",
            desc=True,
            limit=limit
        )
    except SupabaseServiceError as exc:
        logger.error("Failed to get continuity timeline: %s", exc)
        return []

async def record_momentum_snapshot(
    workspace_id: UUID,
    initiative_id: Optional[UUID] = None,
    score: float = 0.0,
    active_collaborators: int = 0,
    synthesis_events: int = 0,
    unresolved_threads: int = 0,
    metadata: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    """Record an operational momentum snapshot (system level)."""
    data = {
        "workspace_id": str(workspace_id),
        "score": score,
        "active_collaborators": active_collaborators,
        "synthesis_events": synthesis_events,
        "unresolved_threads": unresolved_threads,
        "metadata": metadata or {}
    }
    if initiative_id:
        data["initiative_id"] = str(initiative_id)
        
    try:
        return await insert_one_trusted("workspace_momentum_snapshots", data)
    except SupabaseServiceError as exc:
        logger.error("Failed to record momentum snapshot: %s", exc)
        raise ValueError(f"Failed to record momentum: {exc}")

async def add_continuity_memory(
    workspace_id: UUID,
    content: str,
    initiative_id: Optional[UUID] = None,
    resolution_status: str = "unresolved",
    metadata: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    """Add an operational continuity memory (e.g. pending thread, blocked dependency)."""
    data = {
        "workspace_id": str(workspace_id),
        "memory_type": "continuity",
        "content": content,
        "resolution_status": resolution_status,
        "structured_data": metadata or {},
        "importance_score": 0.8
    }
    if initiative_id:
        data["initiative_id"] = str(initiative_id)

    try:
        return await insert_one_trusted("workspace_intelligence_memory", data)
    except SupabaseServiceError as exc:
        logger.error("Failed to add continuity memory: %s", exc)
        raise ValueError(f"Failed to save continuity memory: {exc}")

async def list_unresolved_continuity(
    user_id: UUID,
    workspace_id: UUID
) -> list[dict[str, Any]]:
    """List unresolved continuity memory for a workspace."""
    await require_workspace_access(user_id, workspace_id)

    filters = {
        "workspace_id": str(workspace_id),
        "resolution_status": {"in": ["unresolved", "pending_collaboration", "blocked"]}
    }

    try:
        return await select_all_trusted(
            "workspace_intelligence_memory",
            "*",
            filters=filters,
            order_by="created_at",
            desc=True
        )
    except SupabaseServiceError as exc:
        logger.error("Failed to list unresolved continuity: %s", exc)
        return []
