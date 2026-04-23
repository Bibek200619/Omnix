from typing import Any, List, Optional
import logging
from uuid import UUID
from datetime import datetime

from .supabase_service import select_all_trusted
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
    access = await require_workspace_access(user_id, workspace_id, ["founder", "super_founder", "owner", "co_owner", "sub_leader", "member", "sub_member"])
    if not access:
        raise ValueError("Workspace access denied.")

    client = select_all_trusted()
    data = {
        "workspace_id": str(workspace_id),
        "name": name,
        "description": description,
        "status": "active",
        "momentum_score": 1.0,
        "metadata": metadata or {},
    }
    result = client.table("workspace_initiatives").insert(data).execute()
    if not result.data:
        raise ValueError("Failed to create initiative.")
    
    initiative = result.data[0]
    
    # Log to operational timeline
    timeline_data = {
        "workspace_id": str(workspace_id),
        "initiative_id": initiative["id"],
        "event_type": "initiative_started",
        "summary": f"Initiative '{name}' started.",
        "metadata": {"actor_user_id": str(user_id)}
    }
    client.table("workspace_operational_timeline").insert(timeline_data).execute()
    
    return initiative

async def list_initiatives(
    user_id: UUID,
    workspace_id: UUID,
    status: Optional[str] = None
) -> list[dict[str, Any]]:
    """List initiatives for a workspace."""
    access = await require_workspace_access(user_id, workspace_id)
    if not access:
        raise ValueError("Workspace access denied.")

    client = select_all_trusted()
    query = client.table("workspace_initiatives").select("*").eq("workspace_id", str(workspace_id))
    if status:
        query = query.eq("status", status)
    
    result = query.order("updated_at", desc=True).execute()
    return result.data or []

async def get_continuity_timeline(
    user_id: UUID,
    workspace_id: UUID,
    initiative_id: Optional[UUID] = None,
    limit: int = 50
) -> list[dict[str, Any]]:
    """Retrieve operational timeline events for a workspace or initiative."""
    access = await require_workspace_access(user_id, workspace_id)
    if not access:
        raise ValueError("Workspace access denied.")

    client = select_all_trusted()
    query = client.table("workspace_operational_timeline").select("*").eq("workspace_id", str(workspace_id))
    if initiative_id:
        query = query.eq("initiative_id", str(initiative_id))
    
    result = query.order("created_at", desc=True).limit(limit).execute()
    return result.data or []

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
    client = select_all_trusted()
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
        
    result = client.table("workspace_momentum_snapshots").insert(data).execute()
    if not result.data:
        raise ValueError("Failed to record momentum.")
    return result.data[0]

async def add_continuity_memory(
    workspace_id: UUID,
    content: str,
    initiative_id: Optional[UUID] = None,
    resolution_status: str = "unresolved",
    metadata: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    """Add an operational continuity memory (e.g. pending thread, blocked dependency)."""
    client = select_all_trusted()
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

    result = client.table("workspace_intelligence_memory").insert(data).execute()
    if not result.data:
        raise ValueError("Failed to save continuity memory.")
    return result.data[0]

async def list_unresolved_continuity(
    user_id: UUID,
    workspace_id: UUID
) -> list[dict[str, Any]]:
    """List unresolved continuity memory for a workspace."""
    access = await require_workspace_access(user_id, workspace_id)
    if not access:
        raise ValueError("Workspace access denied.")

    client = select_all_trusted()
    result = (client.table("workspace_intelligence_memory")
              .select("*")
              .eq("workspace_id", str(workspace_id))
              .in_("resolution_status", ["unresolved", "pending_collaboration", "blocked"])
              .order("created_at", desc=True)
              .execute())
    return result.data or []
