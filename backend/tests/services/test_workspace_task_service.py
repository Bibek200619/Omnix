from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.services import workspace_task_service as tasks


@pytest.fixture(autouse=True)
def stub_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_mentions_by_source(**kwargs):
        return {}

    async def fake_sync_mentions(**kwargs):
        return []

    monkeypatch.setattr(tasks, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(tasks, "sync_mentions_for_source", fake_sync_mentions)


def _assert_no_raw_dates(value: object) -> None:
    if isinstance(value, date):
        raise AssertionError(f"raw date escaped serialization: {value!r}")
    if isinstance(value, dict):
        for item in value.values():
            _assert_no_raw_dates(item)
    if isinstance(value, list):
        for item in value:
            _assert_no_raw_dates(item)


@pytest.mark.asyncio
async def test_create_from_message_preserves_discussion_provenance(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "name": "launch"}, object()

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_channel_messages"
        assert filters["id"] == "message-1"
        return {"id": "message-1", "content": "Prepare the release brief before deployment."}

    captured: dict[str, object] = {}

    async def fake_create_task(**kwargs):
        captured.update(kwargs)
        return {"id": "task-1"}

    monkeypatch.setattr(tasks, "_require_channel_access", fake_channel_access)
    monkeypatch.setattr(tasks, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(tasks, "create_task", fake_create_task)

    result = await tasks.create_task_from_message(
        workspace_id="workspace-1",
        channel_id="channel-1",
        message_id="message-1",
        user_id="user-1",
        payload={"title": None, "description": None, "status": "idea"},
    )

    assert result["id"] == "task-1"
    assert captured["origin"] == "conversation_message"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["description"] == "Prepare the release brief before deployment."
    assert payload["linked_context"][0]["context_type"] == "conversation_message"
    assert payload["linked_context"][0]["context_id"] == "message-1"
    assert payload["linked_context"][1]["context_type"] == "channel"


@pytest.mark.asyncio
async def test_create_task_serializes_due_date_before_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    due_date = date(2026, 6, 3)
    captured: dict[str, object] = {}

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_insert(table: str, payload: dict[str, object]):
        assert table == "workspace_tasks"
        _assert_no_raw_dates(payload)
        captured.update(payload)
        return {"id": "task-1", "workspace_id": "workspace-1", **payload}

    async def fake_activity(**kwargs):
        return None

    monkeypatch.setattr(tasks, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(tasks, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(tasks, "log_workspace_activity", fake_activity)

    async def fake_profiles(user_ids: list[str]):
        return {}

    async def fake_select_all(*args, **kwargs):
        return []

    monkeypatch.setattr(tasks, "get_profiles", fake_profiles)
    monkeypatch.setattr(tasks, "select_all_trusted", fake_select_all)

    result = await tasks.create_task(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Prepare launch", "due_date": due_date},
    )

    assert captured["due_date"] == "2026-06-03"
    assert result["due_date"] == "2026-06-03"


@pytest.mark.asyncio
async def test_create_task_persists_structured_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    mention_metadata = [{"user_id": "user-2", "label": "Bibek", "display_name": "Bibek", "avatar_label": "B"}]
    captured_insert: dict[str, object] = {}
    captured_sync: dict[str, object] = {}

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_prepare(**kwargs):
        assert kwargs["mentions"] == [{"user_id": "user-2"}]
        return mention_metadata

    async def fake_insert(table: str, payload: dict[str, object]):
        captured_insert.update(payload)
        return {"id": "task-1", "workspace_id": "workspace-1", **payload}

    async def fake_sync(**kwargs):
        captured_sync.update(kwargs)
        return []

    async def fake_activity(**kwargs):
        return None

    async def fake_profiles(user_ids: list[str]):
        return {}

    async def fake_select_all(*args, **kwargs):
        return []

    monkeypatch.setattr(tasks, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(tasks, "prepare_mentions_for_workspace", fake_prepare)
    monkeypatch.setattr(tasks, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(tasks, "sync_mentions_for_source", fake_sync)
    monkeypatch.setattr(tasks, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(tasks, "get_profiles", fake_profiles)
    monkeypatch.setattr(tasks, "select_all_trusted", fake_select_all)

    result = await tasks.create_task(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Check launch", "mentions": [{"user_id": "user-2"}]},
    )

    assert captured_insert["activity_metadata"] == {"origin": "manual", "mentions": mention_metadata}
    assert captured_sync["source_type"] == "task"
    assert captured_sync["source_id"] == "task-1"
    assert result["mentions"] == mention_metadata


@pytest.mark.asyncio
async def test_update_complete_stamps_recorded_transition(monkeypatch: pytest.MonkeyPatch) -> None:
    current = {
        "id": "task-1",
        "workspace_id": "workspace-1",
        "title": "Verify deployment",
        "status": "active",
        "created_by": "user-1",
        "completed_at": None,
        "blockers": [],
        "linked_context": [],
    }
    captured: dict[str, object] = {}

    async def fake_require_task(**kwargs):
        return current

    async def fake_require_workspace_access(*args):
        return object()

    async def fake_validate_owner(*args):
        return None

    async def fake_update(table: str, filters: dict[str, object], payload: dict[str, object]):
        captured.update(payload)
        return {**current, **payload}

    async def fake_activity(**kwargs):
        return None

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(tasks, "require_task", fake_require_task)
    monkeypatch.setattr(tasks, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(tasks, "_validate_owner", fake_validate_owner)
    monkeypatch.setattr(tasks, "update_one_trusted", fake_update)
    monkeypatch.setattr(tasks, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(tasks, "get_profiles", fake_profiles)

    updated = await tasks.update_task(
        workspace_id="workspace-1",
        task_id="task-1",
        user_id="user-1",
        payload={"status": "complete"},
    )

    assert updated["status"] == "complete"
    assert captured["completed_at"] is not None


@pytest.mark.asyncio
async def test_update_task_serializes_due_date_before_update(monkeypatch: pytest.MonkeyPatch) -> None:
    due_date = date(2026, 6, 4)
    current = {
        "id": "task-1",
        "workspace_id": "workspace-1",
        "title": "Verify deployment",
        "status": "active",
        "created_by": "user-1",
        "completed_at": None,
        "blockers": [],
        "linked_context": [],
    }
    captured: dict[str, object] = {}

    async def fake_require_task(**kwargs):
        return current

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_update(table: str, filters: dict[str, object], payload: dict[str, object]):
        assert table == "workspace_tasks"
        assert filters == {"id": "task-1", "workspace_id": "workspace-1"}
        _assert_no_raw_dates(payload)
        captured.update(payload)
        return {**current, **payload}

    async def fake_activity(**kwargs):
        return None

    async def fake_profiles(user_ids: list[str]):
        return {}

    async def fake_select_all(*args, **kwargs):
        return []

    monkeypatch.setattr(tasks, "require_task", fake_require_task)
    monkeypatch.setattr(tasks, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(tasks, "update_one_trusted", fake_update)
    monkeypatch.setattr(tasks, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(tasks, "get_profiles", fake_profiles)
    monkeypatch.setattr(tasks, "select_all_trusted", fake_select_all)

    result = await tasks.update_task(
        workspace_id="workspace-1",
        task_id="task-1",
        user_id="user-1",
        payload={"due_date": due_date},
    )

    assert captured["due_date"] == "2026-06-04"
    assert result["due_date"] == "2026-06-04"


@pytest.mark.asyncio
async def test_momentum_reports_only_recorded_task_state(monkeypatch: pytest.MonkeyPatch) -> None:
    today = date.today()

    async def fake_list_tasks(**kwargs):
        return [
            {"status": "active", "blockers": ["Awaiting access"], "owner_user_id": "user-1", "due_date": today.isoformat()},
            {"status": "planned", "blockers": [], "owner_user_id": None, "due_date": (today + timedelta(days=3)).isoformat()},
            {"status": "review", "blockers": [], "owner_user_id": "user-2", "due_date": (today - timedelta(days=1)).isoformat()},
            {"status": "complete", "blockers": ["Historical"], "owner_user_id": None, "due_date": None},
        ]

    monkeypatch.setattr(tasks, "list_tasks", fake_list_tasks)

    result = await tasks.task_momentum(workspace_id="workspace-1", user_id="user-1")

    assert result["total_count"] == 4
    assert result["open_count"] == 3
    assert result["blocked_count"] == 1
    assert result["due_soon_count"] == 2
    assert result["overdue_count"] == 1
    assert result["unassigned_count"] == 1
    assert result["flow_counts"]["complete"] == 1
    assert result["health"] == "blocked"


@pytest.mark.asyncio
async def test_initiative_link_must_remain_inside_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_initiatives"
        assert filters == {"id": "initiative-other", "workspace_id": "workspace-1"}
        return None

    monkeypatch.setattr(tasks, "select_one_trusted", fake_select_one)

    with pytest.raises(Exception) as exc_info:
        await tasks._validate_initiative("workspace-1", "initiative-other")

    assert getattr(exc_info.value, "status_code", None) == 400
