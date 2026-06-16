from __future__ import annotations

from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from app.services import workspace_conversation_service as conversations
from app.services.supabase_service import SupabaseServiceError


@pytest.fixture(autouse=True)
def stub_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_mentions_by_source(**kwargs):
        return {}

    async def fake_sync_mentions(**kwargs):
        return []

    monkeypatch.setattr(conversations, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(conversations, "sync_mentions_for_source", fake_sync_mentions)


def test_channel_slug_is_operational_and_stable() -> None:
    assert conversations.channel_slug(" Backend / API Readiness ") == "backend-api-readiness"
    assert conversations.channel_slug("!!!") == "discussion"


@pytest.mark.asyncio
async def test_list_channels_continues_when_default_seed_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []

    async def fake_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        calls.append((table, columns))
        assert table == "workspace_channels"
        return []

    async def fake_insert(table: str, payload: dict[str, object]):
        assert table == "workspace_channels"
        raise SupabaseServiceError("relation workspace_channels does not exist")

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_channels"
        return None

    monkeypatch.setattr(conversations, "require_workspace_access", fake_access)
    monkeypatch.setattr(conversations, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(conversations, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(conversations, "select_one_trusted", fake_select_one)

    result = await conversations.list_channels(workspace_id="workspace-1", user_id="user-1")

    assert result == []
    assert calls == [
        ("workspace_channels", "slug"),
        ("workspace_channels", conversations.CHANNEL_COLUMNS),
    ]


@pytest.mark.asyncio
async def test_list_messages_loads_latest_roots_and_reply_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "visibility": "workspace"}, SimpleNamespace(workspace={"id": "workspace-1"})

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

    async def fake_list_workspace_members(workspace: dict[str, object]):
        assert workspace == {"id": "workspace-1"}
        return [
            {
                "user_id": "user-1",
                "role": "team_lead",
                "operational_label": "Backend",
                "full_name": "Rhea",
                "avatar_label": "R",
            }
        ]

    async def fake_get_profiles(user_ids: list[str]):
        assert user_ids == []
        return {}

    monkeypatch.setattr(conversations, "_require_channel_access", fake_require_channel_access)
    monkeypatch.setattr(conversations, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(conversations, "list_workspace_members", fake_list_workspace_members)
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
    assert result[0]["author_identity"]["display_label"] == "Team Lead \u2022 Backend"


@pytest.mark.asyncio
async def test_list_messages_survives_failed_mention_hydration_and_legacy_context_links(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_require_channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "visibility": "workspace"}, SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        assert table == "workspace_channel_messages"
        if filters.get("parent_message_id") == {"is": None}:
            return [
                {
                    "id": "root-1",
                    "workspace_id": "workspace-1",
                    "channel_id": "channel-1",
                    "author_user_id": "user-1",
                    "parent_message_id": None,
                    "content": "Check the source link.",
                    "context_links": [
                        {"context_type": "task", "context_id": "task-1", "label": "Launch task"},
                        {"context_type": "unknown", "context_id": "ignored"},
                    ],
                    "metadata": {
                        "mentions": [
                            {
                                "user_id": "user-2",
                                "label": "Bibek",
                                "avatar_label": "B",
                            }
                        ]
                    },
                }
            ]
        return []

    async def fake_mentions_by_source(**kwargs):
        raise HTTPException(status_code=500, detail="Internal server error")

    async def fake_list_workspace_members(workspace: dict[str, object]):
        return [{"user_id": "user-1", "role": "member", "full_name": "Alex", "avatar_label": "A"}]

    async def fake_get_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(conversations, "_require_channel_access", fake_require_channel_access)
    monkeypatch.setattr(conversations, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(conversations, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(conversations, "list_workspace_members", fake_list_workspace_members)
    monkeypatch.setattr(conversations, "get_profiles", fake_get_profiles)

    result = await conversations.list_messages(
        workspace_id="workspace-1",
        channel_id="channel-1",
        user_id="user-1",
        limit=20,
        offset=0,
    )

    assert result[0]["mentions"] == [{"user_id": "user-2", "label": "Bibek", "avatar_label": "B"}]
    assert result[0]["context_links"] == [
        {"entity_type": "task", "entity_id": "task-1", "label": "Launch task"}
    ]


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
        return {
            "id": kwargs["channel_id"],
            "posting_policy": "members",
        }, SimpleNamespace(role="member", workspace={"id": "workspace-1"})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert filters["client_nonce"] == "nonce-1"
        return existing

    async def fake_insert(*args, **kwargs):
        nonlocal insert_called
        insert_called = True
        return existing

    async def fake_list_workspace_members(workspace: dict[str, object]):
        return [{"user_id": "user-1", "role": "member", "avatar_label": "U"}]

    async def fake_get_profiles(user_ids: list[str]):
        assert user_ids == []
        return {}

    monkeypatch.setattr(conversations, "_require_channel_access", fake_require_channel_access)
    monkeypatch.setattr(conversations, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(conversations, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(conversations, "list_workspace_members", fake_list_workspace_members)
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
async def test_create_message_persists_structured_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    mention_metadata = [
        {
            "user_id": "user-2",
            "label": "Bibek",
            "display_name": "Bibek",
            "email": "bibek@example.com",
            "avatar_url": None,
            "avatar_label": "B",
            "operational_label": "Engineering",
        }
    ]
    captured_sync: dict[str, object] = {}

    async def fake_require_channel_access(**kwargs):
        return {
            "id": kwargs["channel_id"],
            "visibility": "workspace",
            "posting_policy": "members",
        }, SimpleNamespace(role="member", workspace={"id": "workspace-1"})

    async def fake_prepare(**kwargs):
        assert kwargs["mentions"] == [{"user_id": "user-2"}]
        return mention_metadata

    async def fake_insert(table: str, payload: dict[str, object]):
        assert table == "workspace_channel_messages"
        assert payload["metadata"] == {"mentions": mention_metadata}
        return {"id": "message-1", **payload}

    async def fake_sync(**kwargs):
        captured_sync.update(kwargs)
        return []

    async def fake_mentions_by_source(**kwargs):
        return {"message-1": mention_metadata}

    async def fake_list_workspace_members(workspace: dict[str, object]):
        return [{"user_id": "user-1", "role": "member", "avatar_label": "A"}]

    async def fake_get_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(conversations, "_require_channel_access", fake_require_channel_access)
    monkeypatch.setattr(conversations, "prepare_mentions_for_workspace", fake_prepare)
    monkeypatch.setattr(conversations, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(conversations, "sync_mentions_for_source", fake_sync)
    monkeypatch.setattr(conversations, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(conversations, "list_workspace_members", fake_list_workspace_members)
    monkeypatch.setattr(conversations, "get_profiles", fake_get_profiles)

    result = await conversations.create_message(
        workspace_id="workspace-1",
        channel_id="channel-1",
        user_id="user-1",
        payload={"content": "@Bibek please check this.", "mentions": [{"user_id": "user-2"}]},
    )

    assert result["mentions"] == mention_metadata
    assert captured_sync["source_type"] == "conversation_message"
    assert captured_sync["source_id"] == "message-1"
    assert captured_sync["mentions"] == mention_metadata


@pytest.mark.asyncio
async def test_channel_assistance_transcript_includes_thread_replies(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "visibility": "workspace"}, SimpleNamespace(workspace={"id": "workspace-1"})

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

    async def fake_list_workspace_members(workspace: dict[str, object]):
        return []

    async def fake_get_profiles(user_ids: list[str]):
        assert user_ids == ["user-1", "user-2"]
        return {}

    monkeypatch.setattr(conversations, "_require_channel_access", fake_require_channel_access)
    monkeypatch.setattr(conversations, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(conversations, "list_workspace_members", fake_list_workspace_members)
    monkeypatch.setattr(conversations, "get_profiles", fake_get_profiles)

    result = await conversations.channel_transcript_for_assistance(
        workspace_id="workspace-1",
        channel_id="channel-1",
        user_id="user-1",
        thread_root_id=None,
    )

    assert [message["id"] for message in result] == ["root-1", "reply-1"]


def test_ambient_identity_omits_generic_role_and_keeps_operational_label() -> None:
    assert conversations._author_identity({"role": "member"}) is None
    assert conversations._author_identity({"role": "member", "operational_label": "Design"}) == {
        "role_label": None,
        "operational_label": "Design",
        "display_label": "Design",
    }
