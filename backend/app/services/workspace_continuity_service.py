from typing import Any, Optional
from uuid import UUID

from .supabase_service import insert_one_trusted, select_all_trusted
from .workspace_service import require_workspace_access


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
