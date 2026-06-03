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
