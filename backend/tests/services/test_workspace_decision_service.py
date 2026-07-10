from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import workspace_decision_service as decisions


@pytest.fixture(autouse=True)
def stub_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_mentions_by_source(**kwargs):
        return {}

    async def fake_sync_mentions(**kwargs):
        return []

    monkeypatch.setattr(decisions, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(decisions, "sync_mentions_for_source", fake_sync_mentions)


@pytest.mark.asyncio
async def test_create_from_message_preserves_decision_source_references(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "name": "platform"}, SimpleNamespace(workspace={"id": kwargs["workspace_id"]})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_channel_messages"
        assert filters == {"id": "message-1", "workspace_id": "workspace-1", "channel_id": "channel-1"}
        return {"id": "message-1", "content": "Use Supabase Realtime for live workspace updates."}

    captured: dict[str, object] = {}

    async def fake_create_decision(**kwargs):
        captured.update(kwargs)
        return {"id": "decision-1"}

    monkeypatch.setattr(decisions, "_require_channel_access", fake_channel_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "create_decision", fake_create_decision)

    result = await decisions.create_decision_from_message(
        workspace_id="workspace-1",
        channel_id="channel-1",
        message_id="message-1",
        user_id="user-1",
        payload={"title": None, "description": None, "decision_reason": "Realtime keeps presence coherent.", "status": "accepted"},
    )

    assert result["id"] == "decision-1"
    assert captured["origin"] == "conversation_message"
    assert captured["source_channel_id"] == "channel-1"
    assert captured["source_message_id"] == "message-1"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["title"] == "Use Supabase Realtime for live workspace updates."
    assert payload["description"] == "Use Supabase Realtime for live workspace updates."
    assert payload["decision_reason"] == "Realtime keeps presence coherent."


@pytest.mark.asyncio
async def test_list_decisions_hydrates_creator_without_deriving_state(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        assert workspace_id == "workspace-1"
        assert user_id == "user-1"
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        assert table == "workspace_decisions"
        assert filters == {"workspace_id": "workspace-1"}
        return [
            {
                "id": "decision-1",
                "workspace_id": "workspace-1",
                "title": "Adopt GitHub Flow",
                "description": None,
                "decision_reason": None,
                "status": "accepted",
                "source_message_id": None,
                "source_channel_id": None,
                "created_by": "user-2",
            }
        ]

    async def fake_profiles(user_ids: list[str]):
        assert user_ids == ["user-2"]
        return {"user-2": {"full_name": "Mira Patel", "email": "mira@example.com", "avatar_label": "M"}}

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    result = await decisions.list_decisions(workspace_id="workspace-1", user_id="user-1")

    assert result[0]["title"] == "Adopt GitHub Flow"
    assert result[0]["status"] == "accepted"
    assert result[0]["creator_name"] == "Mira Patel"
    assert "score" not in result[0]


@pytest.mark.asyncio
async def test_create_decision_requires_rationale_without_source(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fail_prepare_mentions(**kwargs):
        raise AssertionError("mentions should not be prepared for an invalid decision")

    async def fail_insert(*args, **kwargs):
        raise AssertionError("invalid decision should not be inserted")

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fail_prepare_mentions)
    monkeypatch.setattr(decisions, "insert_one_trusted", fail_insert)

    with pytest.raises(Exception) as exc_info:
        await decisions.create_decision(
            workspace_id="workspace-1",
            user_id="user-1",
            payload={"title": "Adopt the rollout plan", "status": "accepted"},
        )

    assert getattr(exc_info.value, "status_code", None) == 400
    assert getattr(exc_info.value, "detail", None) == "Decision rationale or source evidence is required."


@pytest.mark.asyncio
async def test_create_decision_allows_source_reference_without_rationale(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_prepare_mentions(**kwargs):
        return []

    async def fake_insert(table: str, payload: dict[str, object]):
        assert table == "workspace_decisions"
        captured.update(payload)
        return {"id": "decision-1", "workspace_id": "workspace-1", "created_by": "user-1", **payload}

    async def fake_activity(**kwargs):
        return None

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fake_prepare_mentions)
    monkeypatch.setattr(decisions, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(decisions, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    result = await decisions.create_decision(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Use the conversation decision", "status": "accepted"},
        origin="conversation_message",
        source_channel_id="channel-1",
        source_message_id="message-1",
    )

    assert captured["decision_reason"] is None
    assert captured["source_channel_id"] == "channel-1"
    assert captured["source_message_id"] == "message-1"
    assert result["source_channel_id"] == "channel-1"
    assert result["source_message_id"] == "message-1"


@pytest.mark.asyncio
async def test_create_decision_persists_structured_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    mention_metadata = [{"user_id": "user-2", "label": "Bibek", "display_name": "Bibek", "avatar_label": "B"}]
    captured_sync: dict[str, object] = {}

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_prepare(**kwargs):
        assert kwargs["mentions"] == [{"user_id": "user-2"}]
        return mention_metadata

    async def fake_insert(table: str, payload: dict[str, object]):
        assert table == "workspace_decisions"
        return {"id": "decision-1", "workspace_id": "workspace-1", **payload}

    async def fake_sync(**kwargs):
        captured_sync.update(kwargs)
        return []

    async def fake_activity(**kwargs):
        return None

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fake_prepare)
    monkeypatch.setattr(decisions, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(decisions, "sync_mentions_for_source", fake_sync)
    monkeypatch.setattr(decisions, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    async def fake_mentions_by_source(**kwargs):
        return {"decision-1": mention_metadata}

    monkeypatch.setattr(decisions, "mention_metadata_for_sources", fake_mentions_by_source)

    result = await decisions.create_decision(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={
            "title": "Prioritize mobile mention picker",
            "decision_reason": "@Bibek confirmed mobile coverage.",
            "status": "accepted",
            "mentions": [{"user_id": "user-2"}],
        },
    )

    assert captured_sync["source_type"] == "decision"
    assert captured_sync["source_id"] == "decision-1"
    assert result["mentions"] == mention_metadata
