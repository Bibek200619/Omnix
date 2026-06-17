from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import workspace_analytics_service as analytics


NOW = datetime(2026, 6, 17, 12, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_workspace_analytics_counts_database_rows_exactly(monkeypatch: pytest.MonkeyPatch) -> None:
    access_calls: list[tuple[str, str]] = []
    seen_queries: list[tuple[str, dict[str, Any]]] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        access_calls.append((workspace_id, user_id))
        return SimpleNamespace(workspace={"id": workspace_id})

    counts_by_table = {
        "workspace_channel_messages": 2,
        "files": 2,
        "workspace_tasks": 3,
        "workspace_decisions": 1,
        "conversations": 2,
    }
    activity_rows = [
        {"id": "activity-1", "actor_user_id": "user-1", "created_at": "2026-06-17T09:00:00+00:00"},
        {"id": "activity-2", "actor_user_id": "user-1", "created_at": "2026-06-16T09:00:00+00:00"},
        {"id": "activity-3", "actor_user_id": "user-2", "created_at": "2026-06-15T09:00:00+00:00"},
        {"id": "activity-4", "actor_user_id": None, "created_at": "2026-06-14T09:00:00+00:00"},
        {"id": "activity-5", "actor_user_id": "user-3", "created_at": "2026-06-05T09:00:00+00:00"},
    ]

    async def fake_select_count_trusted(table: str, filters: dict[str, Any] | None = None) -> int:
        assert filters == {
            "workspace_id": "workspace-1",
            "created_at": {"gte": "2026-05-18T12:00:00+00:00"},
        }
        seen_queries.append((table, filters))
        return counts_by_table[table]

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        assert table == "workspace_activity_events"
        assert filters == {
            "workspace_id": "workspace-1",
            "created_at": {"gte": "2026-06-04T00:00:00+00:00"},
        }
        seen_queries.append((table, filters))
        return activity_rows

    monkeypatch.setattr(analytics, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(analytics, "select_count_trusted", fake_select_count_trusted)
    monkeypatch.setattr(analytics, "select_all_trusted", fake_select_all_trusted)

    result = await analytics.get_workspace_analytics(
        workspace_id="workspace-1",
        user_id="user-1",
        now=NOW,
    )

    assert access_calls == [("workspace-1", "user-1")]
    assert result["message_count"] == 2
    assert result["active_members"] == 2
    assert result["files_uploaded"] == 2
    assert result["tasks_created"] == 3
    assert result["decisions_recorded"] == 1
    assert result["ai_conversations"] == 2
    assert result["activity_by_day"] == [
        {"date": "2026-06-04", "count": 0},
        {"date": "2026-06-05", "count": 1},
        {"date": "2026-06-06", "count": 0},
        {"date": "2026-06-07", "count": 0},
        {"date": "2026-06-08", "count": 0},
        {"date": "2026-06-09", "count": 0},
        {"date": "2026-06-10", "count": 0},
        {"date": "2026-06-11", "count": 0},
        {"date": "2026-06-12", "count": 0},
        {"date": "2026-06-13", "count": 0},
        {"date": "2026-06-14", "count": 1},
        {"date": "2026-06-15", "count": 1},
        {"date": "2026-06-16", "count": 1},
        {"date": "2026-06-17", "count": 1},
    ]
    assert ("workspace_activity_events", {"workspace_id": "workspace-1", "created_at": {"gte": "2026-06-04T00:00:00+00:00"}}) in seen_queries


@pytest.mark.asyncio
async def test_workspace_analytics_requires_access_before_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        assert workspace_id == "workspace-1"
        assert user_id == "user-1"
        raise analytics.HTTPException(status_code=403, detail="No access")

    async def fail_select_count_trusted(*args: Any, **kwargs: Any) -> int:
        raise AssertionError("analytics should not count rows without workspace access")

    async def fail_select_all_trusted(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError("analytics should not read rows without workspace access")

    monkeypatch.setattr(analytics, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(analytics, "select_count_trusted", fail_select_count_trusted)
    monkeypatch.setattr(analytics, "select_all_trusted", fail_select_all_trusted)

    with pytest.raises(analytics.HTTPException) as exc_info:
        await analytics.get_workspace_analytics(workspace_id="workspace-1", user_id="user-1", now=NOW)

    assert exc_info.value.status_code == 403
