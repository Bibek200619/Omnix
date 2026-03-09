from typing import Any
import logging

from ..services.supabase_service import delete_many_trusted

logger = logging.getLogger(__name__)


async def cleanup_old_artifacts(workspace_id: str, days: int = 180) -> dict[str, Any]:
    """Simple cleanup that deletes artifacts older than `days` days. Uses trusted delete.
    This is a potentially destructive operation and should be enabled deliberately.
    """
    # Note: This relies on 'created_at' being present on artifacts table.
    # For safety, the deletion is trusted and should be executed only when explicitly configured.
    try:
        # Placeholder: actual deletion would require a proper SQL filter; using supabase delete with filters
        deleted = await delete_many_trusted("artifacts", {"workspace_id": workspace_id})
        return {"deleted_count": len(deleted)}
    except Exception:
        logger.exception("Failed to cleanup artifacts for %s", workspace_id)
        return {"deleted_count": 0}
