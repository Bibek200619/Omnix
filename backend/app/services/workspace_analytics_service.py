from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, time, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status

from .supabase_service import SupabaseServiceError, select_all_trusted, select_count_trusted
from .workspace_service import require_workspace_access

logger = logging.getLogger(__name__)

ACTIVITY_COLUMNS = "id,actor_user_id,created_at"
THIRTY_DAY_TABLES = {
    "message_count": "workspace_channel_messages",
    "files_uploaded": "files",
    "tasks_created": "workspace_tasks",
    "decisions_recorded": "workspace_decisions",
    "ai_conversations": "conversations",
}


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return _as_utc(value)
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return _as_utc(parsed)


def _iso(value: datetime) -> str:
    return _as_utc(value).isoformat()


def _activity_series(rows: list[dict[str, Any]], *, start_date: datetime, days: int) -> list[dict[str, Any]]:
    start_day = _as_utc(start_date).date()
    allowed_days = {start_day + timedelta(days=offset) for offset in range(days)}
    counts: Counter[str] = Counter()
    for row in rows:
        created_at = _parse_datetime(row.get("created_at"))
        if created_at is None or created_at.date() not in allowed_days:
            continue
        counts[created_at.date().isoformat()] += 1
    return [
        {
            "date": (start_day + timedelta(days=offset)).isoformat(),
            "count": counts[(start_day + timedelta(days=offset)).isoformat()],
        }
        for offset in range(days)
    ]


async def _count_since(*, table: str, workspace_id: str, since: datetime) -> int:
    return await select_count_trusted(
        table,
        filters={"workspace_id": workspace_id, "created_at": {"gte": _iso(since)}},
    )


def _active_member_count(rows: list[dict[str, Any]], *, since: datetime) -> int:
    actor_ids: set[str] = set()
    for row in rows:
        actor_user_id = row.get("actor_user_id")
        if not actor_user_id:
            continue
        created_at = _parse_datetime(row.get("created_at"))
        if created_at is not None and created_at >= since:
            actor_ids.add(str(actor_user_id))
    return len(actor_ids)


async def get_workspace_analytics(
    *,
    workspace_id: str,
    user_id: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)

    current = _as_utc(now or _utc_now())
    thirty_days_ago = current - timedelta(days=30)
    seven_days_ago = current - timedelta(days=7)
    series_start = datetime.combine(current.date() - timedelta(days=13), time.min, tzinfo=timezone.utc)

    try:
        metrics = {
            metric_name: await _count_since(table=table, workspace_id=workspace_id, since=thirty_days_ago)
            for metric_name, table in THIRTY_DAY_TABLES.items()
        }
        activity_rows = await select_all_trusted(
            "workspace_activity_events",
            ACTIVITY_COLUMNS,
            filters={"workspace_id": workspace_id, "created_at": {"gte": _iso(series_start)}},
            order_by="created_at",
            desc=False,
        )
    except SupabaseServiceError as exc:
        logger.exception("Workspace analytics failed | workspace_id=%s", workspace_id)
        raise _database_error() from exc

    return {
        **metrics,
        "active_members": _active_member_count(activity_rows, since=seven_days_ago),
        "activity_by_day": _activity_series(activity_rows, start_date=series_start, days=14),
    }
