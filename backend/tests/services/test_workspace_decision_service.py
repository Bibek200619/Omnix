from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import workspace_decision_service as decisions


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
