from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services import workspace_initiative_service as initiatives


def test_momentum_uses_only_linked_recorded_evidence() -> None:
    record = {"status": "active", "updated_at": datetime.now(timezone.utc).isoformat()}
    tasks = [
        {"status": "active", "blockers": ["Waiting on credentials"], "due_date": None, "updated_at": record["updated_at"]},
        {"status": "complete", "blockers": [], "due_date": None, "updated_at": record["updated_at"]},
    ]
    channels = [{"message_count": 4, "last_message_at": record["updated_at"]}]

    result = initiatives._momentum(record, tasks, channels)

    assert result["health"] == "blocked_execution"
    assert result["task_count"] == 2
    assert result["open_task_count"] == 1
    assert result["blocked_task_count"] == 1
    assert result["discussion_message_count"] == 4


def test_completed_initiative_reports_completion_without_scoring() -> None:
    result = initiatives._momentum({"status": "complete"}, [], [])

    assert result["health"] == "completion_flow"
    assert result["summary"] == "This initiative is marked complete."
    assert "score" not in result


@pytest.mark.asyncio
async def test_hydration_aggregates_only_matching_task_and_visible_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_base_records(workspace_id: str, user_id: str):
        return (
            [
                {"id": "task-linked", "initiative_id": "initiative-1", "status": "active", "blockers": []},
                {"id": "task-other", "initiative_id": "initiative-2", "status": "active", "blockers": []},
            ],
            [{"id": "channel-visible", "name": "launch", "message_count": 2}],
            [
                {"initiative_id": "initiative-1", "channel_id": "channel-visible"},
                {"initiative_id": "initiative-1", "channel_id": "channel-hidden"},
            ],
        )

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(initiatives, "_base_records", fake_base_records)
    monkeypatch.setattr(initiatives, "get_profiles", fake_profiles)

    hydrated = await initiatives._hydrate_initiatives(
        [{"id": "initiative-1", "status": "active", "linked_resources": [], "activity_metadata": {}}],
        workspace_id="workspace-1",
        user_id="user-1",
    )

    assert [task["id"] for task in hydrated[0]["linked_tasks"]] == ["task-linked"]
    assert [channel["id"] for channel in hydrated[0]["linked_channels"]] == ["channel-visible"]
    assert hydrated[0]["momentum"]["channel_count"] == 1
