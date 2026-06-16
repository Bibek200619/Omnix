from typing import Any
import logging
from datetime import datetime, timedelta, timezone

from ..services.supabase_service import delete_many_trusted, select_all_trusted

logger = logging.getLogger(__name__)


def _parse_created_at(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def cleanup_old_artifacts(workspace_id: str, days: int = 180) -> dict[str, Any]:
    """Simple cleanup that deletes artifacts older than `days` days. Uses trusted delete.
    This is a potentially destructive operation and should be enabled deliberately.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))
    try:
        rows = await select_all_trusted(
            "artifacts",
            "id,workspace_id,created_at",
            filters={"workspace_id": workspace_id},
            order_by="created_at",
            desc=False,
            limit=500,
        )
        deleted_count = 0
        for row in rows:
            artifact_id = row.get("id")
            created_at = _parse_created_at(row.get("created_at"))
            if not artifact_id or created_at is None or created_at >= cutoff:
                continue
            deleted = await delete_many_trusted(
                "artifacts",
                {"workspace_id": workspace_id, "id": artifact_id},
            )
            deleted_count += len(deleted)
        return {"deleted_count": deleted_count}
    except Exception:
        logger.exception("Failed to cleanup artifacts for %s", workspace_id)
        return {"deleted_count": 0}
