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
        payload={"title": None, "description": None, "decision_reason": "Realtime keeps presence coherent.", "status": "accepted", "client_nonce": "decision-attempt-1"},
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
    assert payload["client_nonce"] == "decision-attempt-1"


@pytest.mark.asyncio
async def test_create_decision_reuses_existing_client_nonce_without_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = {
        "id": "decision-existing",
        "workspace_id": "workspace-1",
        "title": "Keep the committed decision",
        "decision_reason": "Already recorded.",
        "status": "accepted",
        "client_nonce": "decision-attempt-1",
        "created_by": "user-1",
    }

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_decisions"
        assert "client_nonce" in columns
        assert filters == {
            "workspace_id": "workspace-1",
            "created_by": "user-1",
            "client_nonce": "decision-attempt-1",
        }
        return existing

    async def fail_side_effect(*args, **kwargs):
        raise AssertionError("an idempotent replay must not write or emit side effects")

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fail_side_effect)
    monkeypatch.setattr(decisions, "insert_one_trusted", fail_side_effect)
    monkeypatch.setattr(decisions, "log_workspace_activity", fail_side_effect)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    result = await decisions.create_decision(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={
            "title": "A retried request body",
            "decision_reason": "The nonce is authoritative for this attempt.",
            "client_nonce": "decision-attempt-1",
        },
    )

    assert result["id"] == "decision-existing"
    assert result["client_nonce"] == "decision-attempt-1"


@pytest.mark.asyncio
async def test_create_decision_recovers_exact_row_after_concurrent_nonce_race(monkeypatch: pytest.MonkeyPatch) -> None:
    select_attempts = 0
    existing = {
        "id": "decision-race-winner",
        "workspace_id": "workspace-1",
        "title": "The concurrent winner",
        "decision_reason": "Recorded once.",
        "status": "accepted",
        "client_nonce": "decision-race-1",
        "created_by": "user-1",
    }

    class UniqueViolation(Exception):
        code = "23505"

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        nonlocal select_attempts
        assert table == "workspace_decisions"
        assert filters == {
            "workspace_id": "workspace-1",
            "created_by": "user-1",
            "client_nonce": "decision-race-1",
        }
        select_attempts += 1
        return None if select_attempts == 1 else existing

    async def fake_prepare_mentions(**kwargs):
        return []

    async def fake_insert(*args, **kwargs):
        try:
            raise UniqueViolation(
                'duplicate key value violates unique constraint "ux_workspace_decisions_client_nonce"'
            )
        except UniqueViolation as exc:
            raise decisions.SupabaseServiceError("Internal server error") from exc

    async def fail_side_effect(*args, **kwargs):
        raise AssertionError("the losing insert must not emit creation side effects")

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fake_prepare_mentions)
    monkeypatch.setattr(decisions, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(decisions, "sync_mentions_for_source", fail_side_effect)
    monkeypatch.setattr(decisions, "log_workspace_activity", fail_side_effect)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    result = await decisions.create_decision(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={
            "title": "The concurrent winner",
            "decision_reason": "Recorded once.",
            "client_nonce": "decision-race-1",
        },
    )

    assert select_attempts == 2
    assert result["id"] == "decision-race-winner"


@pytest.mark.asyncio
async def test_candidate_replay_does_not_log_acceptance_metric_again(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = {
        "id": "decision-existing-candidate",
        "workspace_id": "workspace-1",
        "title": "Existing candidate decision",
        "decision_reason": "Already accepted.",
        "status": "proposed",
        "source_type": "conversation",
        "source_id": "channel-1",
        "client_nonce": "candidate-attempt-1",
        "created_by": "user-1",
    }

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert filters["client_nonce"] == "candidate-attempt-1"
        return existing

    async def fail_metric(**kwargs):
        raise AssertionError("an idempotent candidate replay must not log acceptance twice")

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "log_candidate_metrics", fail_metric)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    result = await decisions.create_decision_from_candidate(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={
            "candidate_id": "candidate-1",
            "title": "Existing candidate decision",
            "source_type": "conversation",
            "source_id": "channel-1",
            "source_evidence": [],
            "client_nonce": "candidate-attempt-1",
        },
    )

    assert result["id"] == "decision-existing-candidate"


@pytest.mark.asyncio
async def test_candidate_nonce_race_does_not_log_losing_acceptance_metric(monkeypatch: pytest.MonkeyPatch) -> None:
    select_attempts = 0
    existing = {
        "id": "decision-candidate-winner",
        "workspace_id": "workspace-1",
        "title": "Candidate race winner",
        "decision_reason": "Accepted once.",
        "status": "proposed",
        "source_type": "conversation",
        "source_id": "channel-1",
        "source_evidence": [{"kind": "conversation_message"}],
        "client_nonce": "candidate-race-1",
        "created_by": "user-1",
    }

    class UniqueViolation(Exception):
        code = "23505"

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        nonlocal select_attempts
        select_attempts += 1
        return None if select_attempts == 1 else existing

    async def fake_resolve_source_reference(**kwargs):
        return "conversation", "channel-1", "channel-1", None

    async def fake_validated_evidence(**kwargs):
        return [{"kind": "conversation_message"}]

    async def fake_prepare_mentions(**kwargs):
        return []

    async def fake_insert(*args, **kwargs):
        try:
            raise UniqueViolation(
                'duplicate key value violates unique constraint "ux_workspace_decisions_client_nonce"'
            )
        except UniqueViolation as exc:
            raise decisions.SupabaseServiceError("Internal server error") from exc

    async def fail_side_effect(**kwargs):
        raise AssertionError("the losing candidate request must not emit acceptance side effects")

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "_resolve_source_reference", fake_resolve_source_reference)
    monkeypatch.setattr(decisions, "_validated_candidate_evidence", fake_validated_evidence)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fake_prepare_mentions)
    monkeypatch.setattr(decisions, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(decisions, "sync_mentions_for_source", fail_side_effect)
    monkeypatch.setattr(decisions, "log_workspace_activity", fail_side_effect)
    monkeypatch.setattr(decisions, "log_candidate_metrics", fail_side_effect)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    result = await decisions.create_decision_from_candidate(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={
            "candidate_id": "candidate-race",
            "title": "Candidate race winner",
            "decision_reason": "Accepted once.",
            "source_type": "conversation",
            "source_id": "channel-1",
            "source_evidence": [{"kind": "conversation_message"}],
            "client_nonce": "candidate-race-1",
        },
    )

    assert select_attempts == 2
    assert result["id"] == "decision-candidate-winner"


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
async def test_create_decision_allows_document_source_reference_without_rationale(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "files"
        assert filters == {"id": "file-1", "workspace_id": "workspace-1"}
        return {"id": "file-1"}

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
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fake_prepare_mentions)
    monkeypatch.setattr(decisions, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(decisions, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    result = await decisions.create_decision(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Use the document decision", "status": "accepted", "source_type": "document", "source_id": "file-1"},
    )

    assert captured["decision_reason"] is None
    assert captured["source_type"] == "document"
    assert captured["source_id"] == "file-1"
    assert result["source_type"] == "document"
    assert result["source_id"] == "file-1"


@pytest.mark.asyncio
async def test_create_decision_maps_conversation_source_to_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_channel_access(**kwargs):
        assert kwargs == {"workspace_id": "workspace-1", "channel_id": "channel-1", "user_id": "user-1"}
        return {"id": "channel-1"}, object()

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
    monkeypatch.setattr(decisions, "_require_channel_access", fake_channel_access)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fake_prepare_mentions)
    monkeypatch.setattr(decisions, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(decisions, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    result = await decisions.create_decision(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Use the candidate decision", "status": "accepted", "source_type": "conversation", "source_id": "channel-1"},
    )

    assert captured["source_type"] == "conversation"
    assert captured["source_id"] == "channel-1"
    assert captured["source_channel_id"] == "channel-1"
    assert result["source_channel_id"] == "channel-1"


@pytest.mark.asyncio
async def test_create_decision_rejects_document_source_outside_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "files"
        assert filters == {"id": "file-other", "workspace_id": "workspace-1"}
        return None

    async def fail_insert(*args, **kwargs):
        raise AssertionError("invalid source should not be inserted")

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "insert_one_trusted", fail_insert)

    with pytest.raises(Exception) as exc_info:
        await decisions.create_decision(
            workspace_id="workspace-1",
            user_id="user-1",
            payload={
                "title": "Use the external document",
                "status": "accepted",
                "source_type": "document",
                "source_id": "file-other",
            },
        )

    assert getattr(exc_info.value, "status_code", None) == 400
    assert getattr(exc_info.value, "detail", None) == "Decision source document is not in this workspace."


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


@pytest.mark.asyncio
async def test_create_decision_from_candidate_persists_server_verified_message_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    source_content = "We will use Supabase Realtime for presence updates."
    captured: dict[str, object] = {}
    metric: dict[str, object] = {}

    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_channel_access(**kwargs):
        assert kwargs == {"workspace_id": "workspace-1", "channel_id": "channel-1", "user_id": "user-1"}
        return {"id": "channel-1"}, object()

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_channel_messages"
        assert filters == {"id": "message-1", "workspace_id": "workspace-1", "channel_id": "channel-1"}
        return {
            "id": "message-1",
            "workspace_id": "workspace-1",
            "channel_id": "channel-1",
            "content": source_content,
            "updated_at": "2026-07-25T12:00:00+00:00",
        }

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

    async def fake_metric(**kwargs):
        metric.update(kwargs)

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "_require_channel_access", fake_channel_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fake_prepare_mentions)
    monkeypatch.setattr(decisions, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(decisions, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)
    monkeypatch.setattr(decisions, "log_candidate_metrics", fake_metric)

    result = await decisions.create_decision_from_candidate(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={
            "candidate_id": "conversation-candidate-1",
            "title": "Use Supabase Realtime",
            "decision_reason": "The team explicitly selected the realtime provider.",
            "status": "proposed",
            "source_type": "conversation",
            "source_id": "channel-1",
            "source_evidence": [
                {
                    "kind": "conversation_message",
                    "channel_id": "channel-1",
                    "message_id": "message-1",
                    "char_start": 0,
                    "char_end": len(source_content),
                    "quote": source_content,
                    "source_content_hash": decisions._content_hash(source_content),
                    "source_updated_at": "forged-client-version",
                }
            ],
        },
    )

    evidence = captured["source_evidence"]
    assert isinstance(evidence, list)
    assert evidence[0]["message_id"] == "message-1"
    assert evidence[0]["channel_id"] == "channel-1"
    assert evidence[0]["quote"] == source_content
    assert evidence[0]["quote_sha256"] == decisions._content_hash(source_content)
    assert evidence[0]["source_updated_at"] == "2026-07-25T12:00:00+00:00"
    assert result["source_evidence"] == evidence
    assert metric["action"] == "accept"
    assert metric["candidate_id"] == "conversation-candidate-1"


@pytest.mark.asyncio
async def test_candidate_evidence_rejects_message_from_another_channel_before_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_channel_access(**kwargs):
        return {"id": "channel-1"}, object()

    async def fail_insert(*args, **kwargs):
        raise AssertionError("cross-channel evidence must not be inserted")

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "_require_channel_access", fake_channel_access)
    monkeypatch.setattr(decisions, "insert_one_trusted", fail_insert)

    with pytest.raises(Exception) as exc_info:
        await decisions.create_decision_from_candidate(
            workspace_id="workspace-1",
            user_id="user-1",
            payload={
                "candidate_id": "candidate-1",
                "title": "Use the external channel",
                "source_type": "conversation",
                "source_id": "channel-1",
                "source_evidence": [
                    {
                        "kind": "conversation_message",
                        "channel_id": "channel-other",
                        "message_id": "message-other",
                        "char_start": 0,
                        "char_end": 12,
                        "quote": "Shared quote",
                        "source_content_hash": decisions._content_hash("Shared quote"),
                    }
                ],
            },
        )

    assert getattr(exc_info.value, "status_code", None) == 400
    assert getattr(exc_info.value, "detail", None) == "Candidate evidence is not in the selected conversation."


@pytest.mark.asyncio
async def test_candidate_evidence_rejects_document_chunk_outside_workspace_before_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        if table == "files":
            assert filters == {"id": "file-1", "workspace_id": "workspace-1"}
            return {"id": "file-1"}
        assert table == "documents"
        assert filters == {"id": "chunk-other", "file_id": "file-1", "workspace_id": "workspace-1"}
        return None

    async def fail_insert(*args, **kwargs):
        raise AssertionError("cross-workspace document evidence must not be inserted")

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "insert_one_trusted", fail_insert)

    with pytest.raises(Exception) as exc_info:
        await decisions.create_decision_from_candidate(
            workspace_id="workspace-1",
            user_id="user-1",
            payload={
                "candidate_id": "candidate-1",
                "title": "Use the external document",
                "source_type": "document",
                "source_id": "file-1",
                "source_evidence": [
                    {
                        "kind": "document_chunk",
                        "file_id": "file-1",
                        "chunk_id": "chunk-other",
                        "chunk_index": 2,
                        "char_start": 0,
                        "char_end": 12,
                        "quote": "Shared quote",
                        "source_content_hash": decisions._content_hash("Shared quote"),
                    }
                ],
            },
        )

    assert getattr(exc_info.value, "status_code", None) == 400
    assert getattr(exc_info.value, "detail", None) == "Candidate evidence document chunk is not in this workspace."


@pytest.mark.asyncio
async def test_candidate_evidence_rejects_stale_message_revision_before_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_access(*args, **kwargs):
        return SimpleNamespace(workspace={"id": "workspace-1"})

    async def fake_channel_access(**kwargs):
        return {"id": "channel-1"}, object()

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_channel_messages"
        return {
            "id": "message-1",
            "workspace_id": "workspace-1",
            "channel_id": "channel-1",
            "content": "The source was edited after the candidate scan.",
            "updated_at": "2026-07-25T12:05:00+00:00",
        }

    async def fail_insert(*args, **kwargs):
        raise AssertionError("stale evidence must not be inserted")

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "_require_channel_access", fake_channel_access)
    monkeypatch.setattr(decisions, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(decisions, "insert_one_trusted", fail_insert)

    with pytest.raises(Exception) as exc_info:
        await decisions.create_decision_from_candidate(
            workspace_id="workspace-1",
            user_id="user-1",
            payload={
                "candidate_id": "candidate-1",
                "title": "Use stale evidence",
                "source_type": "conversation",
                "source_id": "channel-1",
                "source_evidence": [
                    {
                        "kind": "conversation_message",
                        "channel_id": "channel-1",
                        "message_id": "message-1",
                        "char_start": 0,
                        "char_end": 12,
                        "quote": "Original text",
                        "source_content_hash": decisions._content_hash("Original text"),
                    }
                ],
            },
        )

    assert getattr(exc_info.value, "status_code", None) == 409
    assert "stale" in str(getattr(exc_info.value, "detail", "")).lower()
