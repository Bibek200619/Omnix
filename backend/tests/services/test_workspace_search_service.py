from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException
import pytest

from app.services import workspace_search_service as search


@pytest.mark.asyncio
async def test_search_workspace_requires_access_for_empty_query(monkeypatch: pytest.MonkeyPatch) -> None:
    access_calls: list[tuple[str, str]] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        access_calls.append((workspace_id, user_id))
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fail_select_all(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError("blank search should not query search tables")

    monkeypatch.setattr(search, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(search, "select_all_trusted", fail_select_all)

    result = await search.search_workspace(workspace_id="workspace-1", user_id="user-1", query="   ")

    assert access_calls == [("workspace-1", "user-1")]
    for group in (
        "conversations",
        "tasks",
        "initiatives",
        "decisions",
        "files",
        "documents",
        "sources",
        "automations",
        "activity",
        "jobs",
        "members",
        "mentions",
        "workspaces",
        "items",
    ):
        assert result[group] == []
    assert result["pagination"] == {
        "limit": search.SEARCH_GROUP_LIMIT,
        "cursor": 0,
        "next_cursor": None,
    }


@pytest.mark.asyncio
async def test_search_workspace_does_not_call_ranked_rpc_when_access_is_denied(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def deny_workspace_access(workspace_id: str, user_id: str):
        assert workspace_id == "workspace-2"
        assert user_id == "user-1"
        raise HTTPException(status_code=403, detail="Workspace access denied")

    async def fail_ranked_workspace(**kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError(f"ranked RPC should not be called without workspace access: {kwargs}")

    monkeypatch.setattr(search, "require_workspace_access", deny_workspace_access)
    monkeypatch.setattr(search, "_search_ranked_workspace", fail_ranked_workspace)

    with pytest.raises(HTTPException) as exc:
        await search.search_workspace(workspace_id="workspace-2", user_id="user-1", query="secret")

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_search_workspace_uses_ranked_rpc_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id, "name": "Launch Workspace"})

    async def fake_ranked_workspace(**kwargs: Any) -> list[dict[str, Any]]:
        assert kwargs == {
            "workspace_id": "workspace-1",
            "query": "launch",
            "limit": 16,
            "cursor": 2,
        }
        return [
            {
                "id": "task-1",
                "workspace_id": "workspace-1",
                "type": "task",
                "title": "Launch checklist",
                "preview": "Finish release readiness",
                "context": "Active",
                "url": "javascript:alert('stale database route')",
                "matched_field": "full_text",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-02T00:00:00+00:00",
            },
            {
                "id": "document-1",
                "workspace_id": "workspace-1",
                "type": "document",
                "title": "Launch evidence",
                "preview": "Release notes",
                "context": "Document",
                "url": "/files?id=file-1",
                "matched_field": "full_text",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-02T00:00:00+00:00",
            },
            {
                "id": "source-1",
                "workspace_id": "workspace-1",
                "type": "source",
                "title": "Launch handbook",
                "preview": "Knowledge link",
                "context": "Connected",
                "url": "/files?source=source-1",
                "matched_field": "full_text",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-02T00:00:00+00:00",
            },
            {
                "id": "automation-1",
                "workspace_id": "workspace-1",
                "type": "automation",
                "title": "Launch digest",
                "preview": "daily_summary",
                "context": "Enabled Automation",
                "url": "/automations?id=automation-1",
                "matched_field": "full_text",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-02T00:00:00+00:00",
            },
            {
                "id": "job-1",
                "workspace_id": "workspace-1",
                "type": "job",
                "title": "ingestion",
                "preview": "internal error: bearer token should not be searchable",
                "context": "Failed",
                "url": "/files?job=job-1",
                "matched_field": "full_text",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-02T00:00:00+00:00",
            },
        ]

    async def fake_conversations(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return []

    async def fake_members(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return []

    async def fake_mentions(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return []

    async def fail_fanout(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError("field fanout should not run when ranked search succeeds")

    monkeypatch.setattr(search, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(search, "_search_ranked_workspace", fake_ranked_workspace)
    monkeypatch.setattr(search, "_search_conversations", fake_conversations)
    monkeypatch.setattr(search, "_search_members", fake_members)
    monkeypatch.setattr(search, "_search_mentions", fake_mentions)
    monkeypatch.setattr(search, "_search_table_fields", fail_fanout)

    result = await search.search_workspace(
        workspace_id="workspace-1",
        user_id="user-1",
        query="launch",
        limit=2,
        cursor=2,
    )

    assert [item["title"] for item in result["tasks"]] == ["Launch checklist"]
    assert result["tasks"][0]["url"] == "/tasks?id=task-1"
    assert result["documents"][0]["url"] == "/files?id=file-1&document=document-1"
    assert result["sources"][0]["url"] == "/sources?source=source-1"
    assert result["automations"] == []
    assert [item["type"] for item in result["items"]] == ["task", "document", "source", "workspace"]
    assert result["jobs"] == []
    assert "bearer token" not in str(result)
    assert result["pagination"] == {"limit": 2, "cursor": 2, "next_cursor": 4}


def test_ranked_result_rejects_unsupported_and_noncanonical_document_destinations() -> None:
    common = {
        "workspace_id": "workspace-1",
        "title": "Search result",
    }

    assert search._ranked_result({
        **common,
        "id": "automation-1",
        "type": "automation",
        "url": "/automations?id=automation-1",
    }) is None
    assert search._ranked_result({
        **common,
        "id": "document-1",
        "type": "document",
        "url": "https://example.com/files?id=file-1",
    }) is None
    assert search._ranked_result({
        **common,
        "id": "document-1",
        "type": "document",
        "url": "/files?id=file-1&document=document-2",
    }) is None


@pytest.mark.asyncio
async def test_search_workspace_groups_workspace_scoped_ilike_results(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_filters: list[tuple[str, dict[str, Any]]] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        assert workspace_id == "workspace-1"
        assert user_id == "user-1"
        return SimpleNamespace(
            workspace={
                "id": workspace_id,
                "name": "Launch Workspace",
                "description": "Launch release readiness",
                "workspace_focus": "engineering",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-03T00:00:00+00:00",
            }
        )

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]):
        raise AssertionError(f"unexpected lookup: {table} {columns} {filters}")

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        assert filters is not None
        workspace_filter = filters.get("workspace_id") or filters.get("payload->>workspace_id")
        assert workspace_filter == "workspace-1"
        seen_filters.append((table, filters))

        if table == "workspace_channels" and "name" not in filters and "last_message_preview" not in filters:
            return [
                {
                    "id": "channel-1",
                    "workspace_id": "workspace-1",
                    "name": "Launch Planning",
                    "purpose": "Coordinate release",
                    "visibility": "workspace",
                    "is_archived": False,
                    "last_message_preview": "Launch blockers cleared",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-02T00:00:00+00:00",
                }
            ]
        if table == "workspace_channels" and "name" in filters:
            assert filters["name"] == {"ilike": "%launch%"}
            return [
                {
                    "id": "channel-1",
                    "workspace_id": "workspace-1",
                    "name": "Launch Planning",
                    "purpose": "Coordinate release",
                    "visibility": "workspace",
                    "last_message_preview": "Launch blockers cleared",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-02T00:00:00+00:00",
                }
            ]
        if table == "workspace_channel_messages":
            assert filters["channel_id"] == ["channel-1"]
            return [
                {
                    "id": "message-1",
                    "workspace_id": "workspace-1",
                    "channel_id": "channel-1",
                    "content": "Launch checklist is ready",
                    "created_at": "2026-06-02T01:00:00+00:00",
                    "updated_at": "2026-06-02T01:00:00+00:00",
                }
            ]
        if table == "workspace_tasks" and "title" in filters:
            return [
                {
                    "id": "task-1",
                    "workspace_id": "workspace-1",
                    "title": "Launch mobile navigation",
                    "description": "Fix small viewport overflow",
                    "status": "active",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        if table == "workspace_initiatives" and "description" in filters:
            return [
                {
                    "id": "initiative-1",
                    "workspace_id": "workspace-1",
                    "title": "Workspace Intelligence",
                    "description": "Launch operational knowledge layer",
                    "status": "focused",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        if table == "workspace_decisions" and "decision_reason" in filters:
            return [
                {
                    "id": "decision-1",
                    "workspace_id": "workspace-1",
                    "title": "Prioritize collaboration",
                    "description": None,
                    "decision_reason": "Launch requires durable team context",
                    "status": "accepted",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        if table == "files" and "file_name" in filters:
            return [
                {
                    "id": "file-1",
                    "workspace_id": "workspace-1",
                    "user_id": "user-1",
                    "file_name": "launch-readiness.md",
                    "file_type": "text/markdown",
                    "size_bytes": 2048,
                    "processing_status": "searchable",
                    "extraction_status": "searchable",
                    "metadata": {},
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        if table == "documents":
            return [
                {
                    "id": "document-1",
                    "workspace_id": "workspace-1",
                    "file_id": "file-1",
                    "content": "Launch checklist evidence from uploaded release notes",
                    "chunk_index": 2,
                    "metadata": {"file_name": "launch-readiness.md"},
                    "source_type": "file",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        if table == "workspace_connectors" and "display_name" in filters:
            return [
                {
                    "id": "connector-1",
                    "workspace_id": "workspace-1",
                    "connector_type": "knowledge_link",
                    "display_name": "Launch Handbook",
                    "status": "connected",
                    "last_error": None,
                    "source_file_id": "file-1",
                    "last_synced_at": "2026-06-03T00:00:00+00:00",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        if table == "automations" and "name" in filters:
            return [
                {
                    "id": "automation-1",
                    "workspace_id": "workspace-1",
                    "name": "Launch digest",
                    "job_type": "daily_summary",
                    "schedule": "0 8 * * *",
                    "interval_seconds": 86400,
                    "enabled": True,
                    "user_id": "user-1",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        if table == "workspace_activity_events" and "summary" in filters:
            return [
                {
                    "id": "activity-1",
                    "workspace_id": "workspace-1",
                    "actor_user_id": "user-2",
                    "event_type": "workspace.launch",
                    "summary": "Launch review completed",
                    "metadata": {"source": "release"},
                    "created_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        if table == "jobs" and "type" in filters:
            assert filters["payload->>workspace_id"] == "workspace-1"
            return [
                {
                    "id": "job-1",
                    "type": "launch_file_ingestion",
                    "status": "completed",
                    "payload": {"workspace_id": "workspace-1", "file_name": "launch-readiness.md"},
                    "progress": 100,
                    "attempts": 1,
                    "error": None,
                    "result": {"summary": "launch indexed"},
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "started_at": "2026-06-01T00:05:00+00:00",
                    "completed_at": "2026-06-01T00:06:00+00:00",
                }
            ]
        return []

    async def fake_list_workspace_members(workspace: dict[str, Any]) -> list[dict[str, Any]]:
        assert workspace["id"] == "workspace-1"
        return [
            {
                "workspace_id": "workspace-1",
                "user_id": "user-2",
                "role": "member",
                "email": "launch@example.com",
                "full_name": "Launch Operator",
                "handle": "launch-operator",
                "operational_label": "Release launch owner",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-03T00:00:00+00:00",
            }
        ]

    async def fake_list_mentions_for_user(**kwargs: Any) -> list[dict[str, Any]]:
        assert kwargs["workspace_id"] == "workspace-1"
        assert kwargs["user_id"] == "user-1"
        return [
            {
                "id": "mention-1",
                "workspace_id": "workspace-1",
                "mentioned_user_id": "user-1",
                "mentioned_by_user_id": "user-2",
                "mentioned_by_name": "Launch Operator",
                "source_type": "task",
                "source_id": "task-1",
                "source_title": "Launch mobile navigation",
                "source_preview": "Release launch checklist needs review",
                "source_url": "/tasks?id=task-1",
                "created_at": "2026-06-03T00:00:00+00:00",
                "read_at": None,
            }
        ]

    async def empty_ranked_workspace(**kwargs: Any) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(search, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(search, "_search_ranked_workspace", empty_ranked_workspace)
    monkeypatch.setattr(search, "select_all_trusted", fake_select_all_trusted)
    monkeypatch.setattr(search, "list_workspace_members", fake_list_workspace_members)
    monkeypatch.setattr(search, "list_mentions_for_user", fake_list_mentions_for_user)

    result = await search.search_workspace(workspace_id="workspace-1", user_id="user-1", query=" launch ")

    assert [item["title"] for item in result["conversations"]] == ["Launch Planning"]
    assert [item["title"] for item in result["members"]] == ["Launch Operator"]
    assert [item["title"] for item in result["mentions"]] == ["Launch mobile navigation"]
    assert [item["title"] for item in result["workspaces"]] == ["Launch Workspace"]
    assert result["conversations"][0]["url"] == "/conversations?channel=channel-1"
    assert result["mentions"][0]["context"] == "Unread Task mention"
    assert all(
        (filters.get("workspace_id") or filters.get("payload->>workspace_id")) == "workspace-1"
        for _, filters in seen_filters
    )


@pytest.mark.asyncio
async def test_search_workspace_filters_private_channels_before_message_search(monkeypatch: pytest.MonkeyPatch) -> None:
    searched_message_channels: list[list[str]] = []
    membership_filters: list[dict[str, Any]] = []

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        assert filters is not None
        if table == "workspace_channels" and "name" not in filters and "last_message_preview" not in filters:
            return [
                {
                    "id": "channel-visible",
                    "workspace_id": "workspace-1",
                    "created_by": "user-2",
                    "name": "General",
                    "visibility": "workspace",
                    "is_archived": False,
                },
                {
                    "id": "channel-member",
                    "workspace_id": "workspace-1",
                    "created_by": "user-2",
                    "name": "Product",
                    "visibility": "private",
                    "is_archived": False,
                },
                {
                    "id": "channel-owner",
                    "workspace_id": "workspace-1",
                    "created_by": "user-1",
                    "name": "Founder Notes",
                    "visibility": "private",
                    "is_archived": False,
                },
                {
                    "id": "channel-hidden",
                    "workspace_id": "workspace-1",
                    "created_by": "user-2",
                    "name": "Leadership",
                    "visibility": "private",
                    "is_archived": False,
                },
            ]
        if table == "workspace_channel_members":
            membership_filters.append(filters)
            return [{"channel_id": "channel-member"}]
        if table == "workspace_channel_messages":
            searched_message_channels.append(filters["channel_id"])
            return []
        return []
    monkeypatch.setattr(search, "select_all_trusted", fake_select_all_trusted)

    await search._search_conversations(
        workspace_id="workspace-1",
        user_id="user-1",
        pattern="%roadmap%",
        query="roadmap",
    )

    assert membership_filters == [
        {
            "channel_id": ["channel-member", "channel-owner", "channel-hidden"],
            "user_id": "user-1",
        }
    ]
    assert searched_message_channels == [["channel-visible", "channel-member", "channel-owner"]]


@pytest.mark.asyncio
async def test_search_workspace_returns_availability_error_without_field_fanout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def unavailable_ranked_search(**_kwargs: Any) -> None:
        return None

    async def fail_if_called(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError("unavailable ranked search must not trigger a table fan-out")

    monkeypatch.setattr(search, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(search, "_search_ranked_workspace", unavailable_ranked_search)
    monkeypatch.setattr(search, "_search_table_fields", fail_if_called)
    monkeypatch.setattr(search, "_search_conversations", fail_if_called)
    monkeypatch.setattr(search, "_search_members", fail_if_called)
    monkeypatch.setattr(search, "_search_mentions", fail_if_called)

    with pytest.raises(HTTPException) as exc_info:
        await search.search_workspace(workspace_id="workspace-1", user_id="user-1", query="roadmap")

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Workspace search is temporarily unavailable. Please try again."
