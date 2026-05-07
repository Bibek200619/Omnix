from __future__ import annotations

import logging
from typing import Any, Mapping
from .supabase_service import insert_one_trusted, SupabaseServiceError

logger = logging.getLogger(__name__)

async def emit_authority_revocation(
    *,
    user_id: str,
    workspace_id: str,
    revocation_type: str = "membership_removed",
    payload: Mapping[str, Any] | None = None,
) -> bool:
    """
    Records an authority revocation event in the database.
    This event is broadcasted via Supabase Realtime to the affected user.
    """
    data = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "revocation_type": revocation_type,
        "payload": dict(payload or {}),
    }
    
    try:
        await insert_one_trusted("authority_revocations", data)
        logger.info(
            "Authority revocation emitted | user_id=%s | workspace_id=%s | type=%s",
            user_id, workspace_id, revocation_type
        )
        return True
    except SupabaseServiceError:
        logger.exception(
            "Failed to emit authority revocation | user_id=%s | workspace_id=%s",
            user_id, workspace_id
        )
        return False
