from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import workspace_mention_service as mentions


@pytest.mark.asyncio
async def test_prepare_mentions_requires_visible_workspace_member(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_members(workspace: dict[str, object]):
        assert workspace == {"id": "workspace-1"}
        return [
            {
                "user_id": "user-2",
                "full_name": "Bibek",
                "handle": "bibek",
                "email": "bibek@example.com",
                "avatar_label": "B",
                "operational_label": "Engineering",
            }
        ]

    monkeypatch.setattr(mentions, "list_workspace_members", fake_members)

    prepared = await mentions.prepare_mentions_for_workspace(
        workspace={"id": "workspace-1"},
        mentions=[{"user_id": "user-2"}, {"user_id": "user-2"}],
    )

    assert prepared == [
        {
            "user_id": "user-2",
            "label": "bibek",
            "display_name": "Bibek",
            "email": "bibek@example.com",
            "avatar_url": None,
            "avatar_label": "B",
            "operational_label": "Engineering",
        }
    ]

    with pytest.raises(Exception) as exc_info:
        await mentions.prepare_mentions_for_workspace(
            workspace={"id": "workspace-1"},
            mentions=[{"user_id": "outside-workspace"}],
        )

    assert getattr(exc_info.value, "status_code", None) == 400


@pytest.mark.asyncio
async def test_sync_mentions_replaces_source_records(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_delete: dict[str, object] = {}
    captured_insert: list[dict[str, object]] = []

    async def fake_delete(table: str, filters: dict[str, object]):
        captured_delete.update({"table": table, "filters": filters})
        return []

    async def fake_insert(table: str, rows: list[dict[str, object]]):
        captured_insert.extend(rows)
        return rows

    monkeypatch.setattr(mentions, "delete_many_trusted", fake_delete)
    monkeypatch.setattr(mentions, "insert_many_trusted", fake_insert)

    result = await mentions.sync_mentions_for_source(
        workspace_id="workspace-1",
        mentioned_by_user_id="user-1",
        source_type="task",
        source_id="task-1",
        mentions=[{"user_id": "user-2"}, {"user_id": "user-3"}],
    )

    assert captured_delete == {
        "table": "workspace_mentions",
        "filters": {"workspace_id": "workspace-1", "source_type": "task", "source_id": "task-1"},
    }
    assert captured_insert == [
        {
            "workspace_id": "workspace-1",
            "mentioned_user_id": "user-2",
            "mentioned_by_user_id": "user-1",
            "source_type": "task",
            "source_id": "task-1",
        },
        {
            "workspace_id": "workspace-1",
            "mentioned_user_id": "user-3",
            "mentioned_by_user_id": "user-1",
            "source_type": "task",
            "source_id": "task-1",
        },
    ]
    assert result == captured_insert


@pytest.mark.asyncio
async def test_mentions_inbox_hides_private_conversation_without_channel_access(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        if table == "workspace_mentions":
            return [
                {
                    "id": "mention-1",
                    "workspace_id": "workspace-1",
                    "mentioned_user_id": "user-2",
                    "mentioned_by_user_id": "user-1",
                    "source_type": "conversation_message",
                    "source_id": "message-1",
                    "created_at": "2026-06-03T10:00:00+00:00",
                    "read_at": None,
                }
            ]
        if table == "workspace_channel_messages":
            return [{"id": "message-1", "channel_id": "channel-private", "content": "Private context"}]
        if table == "workspace_channels":
            return [{"id": "channel-private", "name": "private", "visibility": "private", "created_by": "user-9"}]
        if table == "workspace_channel_members":
            return []
        raise AssertionError(f"Unexpected table {table}")

    async def fake_profiles(user_ids: list[str]):
        return {"user-1": {"full_name": "Alex", "email": "alex@example.com", "avatar_label": "A"}}

    monkeypatch.setattr(mentions, "require_workspace_access", fake_access)
    monkeypatch.setattr(mentions, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(mentions, "get_profiles", fake_profiles)

    result = await mentions.list_mentions_for_user(workspace_id="workspace-1", user_id="user-2")

    assert result == []


@pytest.mark.asyncio
async def test_mentions_inbox_degrades_when_storage_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def broken_select_all(*args, **kwargs):
        raise mentions.SupabaseServiceError("Internal server error")

    monkeypatch.setattr(mentions, "require_workspace_access", fake_access)
    monkeypatch.setattr(mentions, "select_all_trusted", broken_select_all)

    result = await mentions.list_mentions_for_user(workspace_id="workspace-1", user_id="user-2")

    assert result == []


@pytest.mark.asyncio
async def test_mention_metadata_degrades_when_storage_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken_select_all(*args, **kwargs):
        raise mentions.SupabaseServiceError("Internal server error")

    monkeypatch.setattr(mentions, "select_all_trusted", broken_select_all)

    result = await mentions.mention_metadata_for_sources(
        workspace_id="workspace-1",
        source_type="task",
        source_ids=["task-1", "task-2"],
    )

    assert result == {"task-1": [], "task-2": []}


@pytest.mark.asyncio
async def test_count_unread_mentions_uses_visible_unread_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_list_mentions_for_user(**kwargs):
        captured.update(kwargs)
        return [{"id": "mention-1"}, {"id": "mention-2"}]

    monkeypatch.setattr(mentions, "list_mentions_for_user", fake_list_mentions_for_user)

    result = await mentions.count_unread_mentions_for_user(workspace_id="workspace-1", user_id="user-2")

    assert captured == {
        "workspace_id": "workspace-1",
        "user_id": "user-2",
        "only_unread": True,
        "limit": None,
    }
    assert result == {"unread_count": 2}


@pytest.mark.asyncio
async def test_mark_mention_read_scopes_update_to_mentioned_user(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_update: dict[str, object] = {}

    async def fake_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_mentions"
        assert filters == {"id": "mention-1", "workspace_id": "workspace-1", "mentioned_user_id": "user-2"}
        return {
            "id": "mention-1",
            "workspace_id": "workspace-1",
            "mentioned_user_id": "user-2",
            "read_at": None,
        }

    async def fake_update(table: str, filters: dict[str, object], payload: dict[str, object]):
        captured_update.update({"table": table, "filters": filters, "payload": payload})
        return {"id": "mention-1", "read_at": payload["read_at"]}

    monkeypatch.setattr(mentions, "require_workspace_access", fake_access)
    monkeypatch.setattr(mentions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(mentions, "update_one_trusted", fake_update)

    result = await mentions.mark_mention_read(
        workspace_id="workspace-1",
        user_id="user-2",
        mention_id="mention-1",
    )

    assert captured_update["table"] == "workspace_mentions"
    assert captured_update["filters"] == {"id": "mention-1", "workspace_id": "workspace-1", "mentioned_user_id": "user-2"}
    assert "read_at" in captured_update["payload"]
    assert result["mention_id"] == "mention-1"
    assert result["read_at"] == captured_update["payload"]["read_at"]


@pytest.mark.asyncio
async def test_mark_mention_read_preserves_existing_read_timestamp(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        return {"id": "mention-1", "read_at": "2026-06-03T10:00:00+00:00"}

    async def fail_update(*args, **kwargs):
        raise AssertionError("Already-read mentions should not be updated.")

    monkeypatch.setattr(mentions, "require_workspace_access", fake_access)
    monkeypatch.setattr(mentions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(mentions, "update_one_trusted", fail_update)

    result = await mentions.mark_mention_read(
        workspace_id="workspace-1",
        user_id="user-2",
        mention_id="mention-1",
    )

    assert result == {"mention_id": "mention-1", "read_at": "2026-06-03T10:00:00+00:00"}


@pytest.mark.asyncio
async def test_mark_all_mentions_read_updates_unread_rows_only(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_update: dict[str, object] = {}

    async def fake_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_update_many(table: str, filters: dict[str, object], payload: dict[str, object]):
        captured_update.update({"table": table, "filters": filters, "payload": payload})
        return [{"id": "mention-1"}, {"id": "mention-2"}]

    monkeypatch.setattr(mentions, "require_workspace_access", fake_access)
    monkeypatch.setattr(mentions, "update_many_trusted", fake_update_many)

    result = await mentions.mark_all_mentions_read(workspace_id="workspace-1", user_id="user-2")

    assert captured_update["table"] == "workspace_mentions"
    assert captured_update["filters"] == {
        "workspace_id": "workspace-1",
        "mentioned_user_id": "user-2",
        "read_at": {"is": None},
    }
    assert "read_at" in captured_update["payload"]
    assert result["updated_count"] == 2
