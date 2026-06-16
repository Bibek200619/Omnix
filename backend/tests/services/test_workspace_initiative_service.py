from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.schemas.workspace_initiatives import WorkspaceInitiativeRead
from app.services import workspace_initiative_service as initiatives


def _assert_no_raw_dates(value: object) -> None:
    if isinstance(value, date):
        raise AssertionError(f"raw date escaped serialization: {value!r}")
    if isinstance(value, dict):
        for item in value.values():
            _assert_no_raw_dates(item)
    if isinstance(value, list):
        for item in value:
            _assert_no_raw_dates(item)


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
async def test_create_initiative_serializes_target_date_before_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    target_date = date(2026, 6, 3)
    captured: dict[str, object] = {}

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_insert(table: str, payload: dict[str, object]):
        _assert_no_raw_dates(payload)
        if table == "workspace_initiatives":
            captured.update(payload)
            return {"id": "initiative-1", "workspace_id": "workspace-1", **payload}
        if table == "workspace_operational_timeline":
            return {"id": "timeline-1", **payload}
        raise AssertionError(table)

    async def fake_activity(**kwargs):
        return None

    async def fake_hydrate(rows, **kwargs):
        return rows

    monkeypatch.setattr(initiatives, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(initiatives, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(initiatives, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(initiatives, "_hydrate_initiatives", fake_hydrate)

    result = await initiatives.create_initiative(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Stabilize platform", "target_date": target_date},
    )

    assert captured["target_date"] == "2026-06-03"
    assert result["target_date"] == "2026-06-03"


@pytest.mark.asyncio
async def test_update_initiative_serializes_target_date_before_update(monkeypatch: pytest.MonkeyPatch) -> None:
    target_date = date(2026, 6, 4)
    current = {
        "id": "initiative-1",
        "workspace_id": "workspace-1",
        "title": "Stabilize platform",
        "status": "active",
        "created_by": "user-1",
        "completed_at": None,
    }
    captured: dict[str, object] = {}

    async def fake_require_initiative(**kwargs):
        return current

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_update(table: str, filters: dict[str, object], payload: dict[str, object]):
        assert table == "workspace_initiatives"
        assert filters == {"id": "initiative-1", "workspace_id": "workspace-1"}
        _assert_no_raw_dates(payload)
        captured.update(payload)
        return {**current, **payload}

    async def fake_activity(**kwargs):
        return None

    async def fake_hydrate(rows, **kwargs):
        return rows

    monkeypatch.setattr(initiatives, "require_initiative", fake_require_initiative)
    monkeypatch.setattr(initiatives, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(initiatives, "update_one_trusted", fake_update)
    monkeypatch.setattr(initiatives, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(initiatives, "_hydrate_initiatives", fake_hydrate)

    result = await initiatives.update_initiative(
        workspace_id="workspace-1",
        initiative_id="initiative-1",
        user_id="user-1",
        payload={"target_date": target_date},
    )

    assert captured["target_date"] == "2026-06-04"
    assert result["target_date"] == "2026-06-04"


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


@pytest.mark.asyncio
async def test_list_initiatives_normalizes_legacy_rows_for_response_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        if table == "workspace_decisions":
            return []
        assert table == "workspace_initiatives"
        return [
            {
                "id": "initiative-1",
                "workspace_id": "workspace-1",
                "name": "Legacy rollout",
                "status": "completed",
                "linked_resources": {"invalid": True},
                "activity_metadata": None,
            },
            {
                "id": "initiative-2",
                "workspace_id": "workspace-1",
                "name": "Paused legacy initiative",
                "status": "paused",
            },
        ]

    async def fake_base_records(workspace_id: str, user_id: str):
        return [], [], []

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(initiatives, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(initiatives, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(initiatives, "_base_records", fake_base_records)
    monkeypatch.setattr(initiatives, "get_profiles", fake_profiles)

    result = await initiatives.list_initiatives(workspace_id="workspace-1", user_id="user-1")

    for row in result:
        WorkspaceInitiativeRead.model_validate(row)
    assert result[0]["title"] == "Legacy rollout"
    assert result[0]["status"] == "complete"
    assert result[0]["linked_resources"] == []
    assert result[0]["activity_metadata"] == {}
    assert result[1]["status"] == "draft"
