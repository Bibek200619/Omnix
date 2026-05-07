from __future__ import annotations

import pytest

from app.services import workspace_conversation_service as conversations


def test_channel_slug_is_operational_and_stable() -> None:
    assert conversations.channel_slug(" Backend / API Readiness ") == "backend-api-readiness"
    assert conversations.channel_slug("!!!") == "discussion"


@pytest.mark.asyncio
async def test_list_messages_loads_latest_roots_and_reply_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "visibility": "workspace"}, object()

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        assert table == "workspace_channel_messages"
        if filters.get("parent_message_id") == {"is": None}:
            assert kwargs["desc"] is True
            return [
                {
                    "id": "root-new",
                    "workspace_id": "workspace-1",
                    "channel_id": "channel-1",
                    "author_user_id": "user-1",
                    "parent_message_id": None,
                    "content": "newer",
                    "context_links": [],
                    "metadata": {},
                },
                {
                    "id": "root-old",
                    "workspace_id": "workspace-1",
                    "channel_id": "channel-1",
                    "author_user_id": "user-1",
                    "parent_message_id": None,
                    "content": "older",
                    "context_links": [],
                    "metadata": {},
                },
            ]
        return [{"id": "reply-1", "parent_message_id": "root-old"}]

    async def fake_get_profiles(user_ids: list[str]):
        assert user_ids == ["user-1"]
        return {"user-1": {"full_name": "Rhea", "avatar_label": "R"}}

    monkeypatch.setattr(conversations, "_require_channel_access", fake_require_channel_access)
    monkeypatch.setattr(conversations, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(conversations, "get_profiles", fake_get_profiles)

    result = await conversations.list_messages(
        workspace_id="workspace-1",
        channel_id="channel-1",
        user_id="user-1",
        limit=20,
        offset=0,
    )

    assert [row["id"] for row in result] == ["root-old", "root-new"]
    assert result[0]["thread_reply_count"] == 1
    assert result[0]["author_name"] == "Rhea"


@pytest.mark.asyncio
async def test_create_message_reconciles_repeated_client_nonce(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = {
        "id": "message-1",
        "workspace_id": "workspace-1",
        "channel_id": "channel-1",
        "author_user_id": "user-1",
        "parent_message_id": None,
        "content": "Status is stable.",
        "context_links": [],
        "metadata": {},
        "client_nonce": "nonce-1",
    }
    insert_called = False

    async def fake_require_channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "posting_policy": "members"}, type("Access", (), {"role": "member"})()

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert filters["client_nonce"] == "nonce-1"
        return existing

    async def fake_insert(*args, **kwargs):
        nonlocal insert_called
        insert_called = True
        return existing

    async def fake_get_profiles(user_ids: list[str]):
        return {"user-1": {"avatar_label": "U"}}

    monkeypatch.setattr(conversations, "_require_channel_access", fake_require_channel_access)
    monkeypatch.setattr(conversations, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(conversations, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(conversations, "get_profiles", fake_get_profiles)

    result = await conversations.create_message(
        workspace_id="workspace-1",
        channel_id="channel-1",
        user_id="user-1",
        payload={"content": "Status is stable.", "client_nonce": "nonce-1", "context_links": []},
    )

    assert result["id"] == "message-1"
    assert insert_called is False


@pytest.mark.asyncio
async def test_channel_assistance_transcript_includes_thread_replies(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "visibility": "workspace"}, object()

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        assert kwargs["desc"] is True
        return [
            {
                "id": "reply-1",
                "workspace_id": "workspace-1",
                "channel_id": "channel-1",
                "author_user_id": "user-2",
                "parent_message_id": "root-1",
                "content": "The deployment is blocked on credentials.",
                "context_links": [],
                "metadata": {},
            },
            {
                "id": "root-1",
                "workspace_id": "workspace-1",
                "channel_id": "channel-1",
                "author_user_id": "user-1",
                "parent_message_id": None,
                "content": "Launch readiness check.",
                "context_links": [],
                "metadata": {},
            },
        ]

    async def fake_get_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(conversations, "_require_channel_access", fake_require_channel_access)
    monkeypatch.setattr(conversations, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(conversations, "get_profiles", fake_get_profiles)

    result = await conversations.channel_transcript_for_assistance(
        workspace_id="workspace-1",
        channel_id="channel-1",
        user_id="user-1",
        thread_root_id=None,
    )

    assert [message["id"] for message in result] == ["root-1", "reply-1"]
