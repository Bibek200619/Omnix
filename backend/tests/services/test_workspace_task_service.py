from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.services import workspace_task_service as tasks


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
