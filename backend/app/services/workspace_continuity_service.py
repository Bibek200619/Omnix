from typing import Any, Optional
from uuid import UUID

from .supabase_service import insert_one_trusted, select_all_trusted
from .workspace_service import require_workspace_access


async def create_initiative(
    user_id: UUID,
    workspace_id: UUID,
    name: str,
    description: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Create a new operational initiative, tracking continuity in a workspace."""
    await require_workspace_access(str(workspace_id), str(user_id))

    data = {
        "workspace_id": str(workspace_id),
        "name": name,
        "description": description,
        "status": "active",
        "momentum_score": 1.0,
        "metadata": metadata or {},
    }
    initiative = await insert_one_trusted("workspace_initiatives", data)

    timeline_data = {
        "workspace_id": str(workspace_id),
        "initiative_id": initiative["id"],
        "event_type": "initiative_started",
        "summary": f"Initiative '{name}' started.",
        "metadata": {"actor_user_id": str(user_id)},
    }
    await insert_one_trusted("workspace_operational_timeline", timeline_data)

    return initiative


async def list_initiatives(
    user_id: UUID,
    workspace_id: UUID,
    status: Optional[str] = None,
) -> list[dict[str, Any]]:
    """List initiatives for a workspace."""
    await require_workspace_access(str(workspace_id), str(user_id))

    filters: dict[str, Any] = {"workspace_id": str(workspace_id)}
    if status:
        filters["status"] = status

    return await select_all_trusted(
        "workspace_initiatives",
        "*",
        filters=filters,
        order_by="updated_at",
        desc=True,
    )


async def get_continuity_timeline(
    user_id: UUID,
    workspace_id: UUID,
    initiative_id: Optional[UUID] = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Retrieve operational timeline events for a workspace or initiative."""
    await require_workspace_access(str(workspace_id), str(user_id))

    filters: dict[str, Any] = {"workspace_id": str(workspace_id)}
    if initiative_id:
        filters["initiative_id"] = str(initiative_id)

    return await select_all_trusted(
        "workspace_operational_timeline",
        "*",
        filters=filters,
        order_by="created_at",
        desc=True,
        limit=limit,
    )


async def record_momentum_snapshot(
    workspace_id: UUID,
    initiative_id: Optional[UUID] = None,
    score: float = 0.0,
    active_collaborators: int = 0,
    synthesis_events: int = 0,
    unresolved_threads: int = 0,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Record an operational momentum snapshot (system level)."""
    data = {
        "workspace_id": str(workspace_id),
        "score": score,
        "active_collaborators": active_collaborators,
        "synthesis_events": synthesis_events,
        "unresolved_threads": unresolved_threads,
        "metadata": metadata or {},
    }
    if initiative_id:
        data["initiative_id"] = str(initiative_id)

    return await insert_one_trusted("workspace_momentum_snapshots", data)


async def add_continuity_memory(
    workspace_id: UUID,
    content: str,
    initiative_id: Optional[UUID] = None,
    resolution_status: str = "unresolved",
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Add an operational continuity memory."""
    data = {
        "workspace_id": str(workspace_id),
        "memory_type": "continuity",
        "content": content,
        "resolution_status": resolution_status,
        "structured_data": metadata or {},
        "importance_score": 0.8,
    }
    if initiative_id:
        data["initiative_id"] = str(initiative_id)

    return await insert_one_trusted("workspace_intelligence_memory", data)


async def list_unresolved_continuity(
    user_id: UUID,
    workspace_id: UUID,
) -> list[dict[str, Any]]:
    """List unresolved continuity memory for a workspace."""
    await require_workspace_access(str(workspace_id), str(user_id))

    return await select_all_trusted(
        "workspace_intelligence_memory",
        "*",
        filters={
            "workspace_id": str(workspace_id),
            "resolution_status": ["unresolved", "pending_collaboration", "blocked"],
        },
        order_by="created_at",
        desc=True,
    )
