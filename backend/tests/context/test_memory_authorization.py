from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.context import memory
from app.context.memory import MemoryManager
from app.context.schemas import ContextPayload


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "workspace_id,filters",
    [
        ("workspace-1", {"id": "foreign-conversation", "workspace_id": "workspace-1"}),
        (
            None,
            {
                "id": "foreign-conversation",
                "user_id": "user-1",
                "workspace_id": {"is": None},
            },
        ),
    ],
)
async def test_foreign_conversation_is_rejected_before_reading_messages(
    monkeypatch: pytest.MonkeyPatch, workspace_id, filters
) -> None:
    locator = AsyncMock(return_value=None)
    messages = AsyncMock(
        return_value=[{"id": "secret", "content": "foreign-private-text"}]
    )
    monkeypatch.setattr(memory.supabase_service, "select_one_trusted", locator)
    monkeypatch.setattr(memory.supabase_service, "select_all_trusted", messages)

    with pytest.raises(RuntimeError, match="Conversation memory is unavailable"):
        await MemoryManager()._fetch_conversation_memory(
            "foreign-conversation", "user-1", workspace_id, 6
        )

    locator.assert_awaited_once_with("conversations", "id", filters=filters)
    messages.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_id", [None, "workspace-1"])
async def test_authorized_conversation_retains_history_order_and_message_scope(
    monkeypatch: pytest.MonkeyPatch, workspace_id
) -> None:
    locator = AsyncMock(return_value={"id": "conversation-1"})
    messages = AsyncMock(
        return_value=[
            {"id": "new", "role": "assistant", "content": "New"},
            {"id": "old", "role": "user", "content": "Old"},
        ]
    )
    monkeypatch.setattr(memory.supabase_service, "select_one_trusted", locator)
    monkeypatch.setattr(memory.supabase_service, "select_all_trusted", messages)

    citations = await MemoryManager()._fetch_conversation_memory(
        "conversation-1", "user-1", workspace_id, 6
    )

    filters = {"conversation_id": "conversation-1"}
    if workspace_id is None:
        filters["user_id"] = "user-1"
    assert messages.await_args.kwargs["filters"] == filters
    assert [cite.source_id for cite in citations] == ["old", "new"]


@pytest.mark.asyncio
async def test_private_recent_memory_excludes_owned_workspace_conversations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def select(table, columns, *, filters, **kwargs):
        assert table == "conversations"
        # Model an owned workspace title that would match user_id alone.
        if filters.get("workspace_id") != {"is": None}:
            return [
                {"id": "workspace-conversation", "title": "private-workspace-title"}
            ]
        return [{"id": "personal", "title": "Personal"}]

    monkeypatch.setattr(memory.supabase_service, "select_all_trusted", select)
    citations = await MemoryManager()._fetch_recent_conversations("user-1", None, 3)
    assert [cite.source_id for cite in citations] == ["personal"]


@pytest.mark.asyncio
async def test_workspace_memory_denial_prevents_all_content_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deny = AsyncMock(
        side_effect=HTTPException(status_code=404, detail="Workspace not found")
    )
    reads = AsyncMock(
        return_value=[{"id": "secret", "content": "private-workspace-text"}]
    )
    monkeypatch.setattr(memory, "require_workspace_access", deny, raising=False)
    monkeypatch.setattr(memory.supabase_service, "select_all_trusted", reads)

    with pytest.raises(HTTPException) as exc:
        await MemoryManager().fetch_memory(
            ContextPayload(
                query="Summarize", user_id="user-1", workspace_id="foreign-workspace"
            )
        )
    assert exc.value.status_code == 404
    deny.assert_awaited_once_with("foreign-workspace", "user-1")
    reads.assert_not_awaited()


@pytest.mark.asyncio
async def test_workspace_memory_authorizes_before_scoped_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = []

    async def authorize(workspace_id, user_id):
        events.append("authorized")
        assert (workspace_id, user_id) == ("workspace-1", "teammate")

    async def select(table, columns, *, filters, **kwargs):
        assert events[0] == "authorized"
        assert filters == {"workspace_id": "workspace-1"}
        events.append(table)
        return []

    monkeypatch.setattr(memory, "require_workspace_access", authorize, raising=False)
    monkeypatch.setattr(memory.supabase_service, "select_all_trusted", select)
    assert (
        await MemoryManager().fetch_memory(
            ContextPayload(
                query="Summarize", user_id="teammate", workspace_id="workspace-1"
            )
        )
        == []
    )
    assert events == ["authorized", "workspace_intelligence_memory", "conversations"]


@pytest.mark.asyncio
async def test_locator_failure_does_not_leak_or_read_message_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    locator = AsyncMock(side_effect=RuntimeError("private-db-query-secret"))
    reads = AsyncMock()
    monkeypatch.setattr(memory.supabase_service, "select_one_trusted", locator)
    monkeypatch.setattr(memory.supabase_service, "select_all_trusted", reads)
    with pytest.raises(RuntimeError, match="Conversation memory is unavailable") as exc:
        await MemoryManager()._fetch_conversation_memory(
            "conversation-1", "user-1", None, 6
        )
    assert "private-db-query-secret" not in str(exc.value)
    assert exc.value.__suppress_context__
    reads.assert_not_awaited()
