from __future__ import annotations

from types import SimpleNamespace
from typing import Any

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
    assert result == {"conversations": [], "tasks": [], "initiatives": [], "decisions": []}


@pytest.mark.asyncio
async def test_search_workspace_groups_workspace_scoped_full_text_results(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_filters: list[tuple[str, dict[str, Any]]] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        assert workspace_id == "workspace-1"
        assert user_id == "user-1"
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]):
        raise AssertionError(f"unexpected lookup: {table} {columns} {filters}")

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        assert filters is not None
        assert filters["workspace_id"] == "workspace-1"
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
            assert filters["name"] == {"fts": {"config": "english", "query": "launch:*"}}
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
            assert filters["content"] == {"fts": {"config": "english", "query": "launch:*"}}
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
            assert filters["title"] == {"fts": {"config": "english", "query": "launch:*"}}
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
            assert filters["description"] == {"fts": {"config": "english", "query": "launch:*"}}
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
            assert filters["decision_reason"] == {"fts": {"config": "english", "query": "launch:*"}}
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
        return []

    monkeypatch.setattr(search, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(search, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(search, "select_all_trusted", fake_select_all_trusted)

    result = await search.search_workspace(workspace_id="workspace-1", user_id="user-1", query=" launch ")

    assert [item["title"] for item in result["tasks"]] == ["Launch mobile navigation"]
    assert [item["title"] for item in result["decisions"]] == ["Prioritize collaboration"]
    assert [item["title"] for item in result["initiatives"]] == ["Workspace Intelligence"]
    assert [item["title"] for item in result["conversations"]] == ["Launch Planning"]
    assert result["tasks"][0]["url"] == "/tasks?id=task-1"
    assert result["decisions"][0]["url"] == "/decisions?id=decision-1"
    assert result["initiatives"][0]["url"] == "/initiatives?id=initiative-1"
    assert result["conversations"][0]["url"] == "/conversations?channel=channel-1"
    assert all(filters["workspace_id"] == "workspace-1" for _, filters in seen_filters)


@pytest.mark.asyncio
async def test_search_table_fields_falls_back_to_ilike_when_full_text_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen_filters: list[dict[str, Any]] = []

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        assert filters is not None
        seen_filters.append(filters)
        if filters["title"].get("fts"):
            raise search.SupabaseServiceError("full text unavailable")
        assert filters["title"] == {"ilike": "%launch%"}
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

    monkeypatch.setattr(search, "select_all_trusted", fake_select_all_trusted)

    rows = await search._search_table_fields(
        table="workspace_tasks",
        columns=search.TASK_COLUMNS,
        workspace_id="workspace-1",
        fields=("title",),
        query="launch",
        pattern="%launch%",
    )

    assert rows[0]["id"] == "task-1"
    assert [filters["title"] for filters in seen_filters] == [
        {"fts": {"config": "english", "query": "launch:*"}},
        {"ilike": "%launch%"},
    ]


@pytest.mark.asyncio
async def test_search_workspace_filters_private_channels_before_message_search(monkeypatch: pytest.MonkeyPatch) -> None:
    searched_message_channels: list[list[str]] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]):
        assert table == "workspace_channel_members"
        assert filters == {"channel_id": "channel-hidden", "user_id": "user-1"}
        return None

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
                    "id": "channel-hidden",
                    "workspace_id": "workspace-1",
                    "created_by": "user-2",
                    "name": "Leadership",
                    "visibility": "private",
                    "is_archived": False,
                },
            ]
        if table == "workspace_channel_messages":
            searched_message_channels.append(filters["channel_id"])
            return []
        return []

    monkeypatch.setattr(search, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(search, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(search, "select_all_trusted", fake_select_all_trusted)

    await search.search_workspace(workspace_id="workspace-1", user_id="user-1", query="roadmap")

    assert searched_message_channels == [["channel-visible"]]


@pytest.mark.asyncio
async def test_search_workspace_organization_scope_searches_user_workspaces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    access_calls: list[tuple[str, str]] = []
    list_calls: list[str] = []
    searched_workspace_filters: list[Any] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        access_calls.append((workspace_id, user_id))
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_list_user_workspaces(user_id: str):
        list_calls.append(user_id)
        return [{"id": "workspace-1"}, {"id": "workspace-2"}, {"id": "workspace-3"}]

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]):
        return None

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        assert filters is not None
        searched_workspace_filters.append(filters["workspace_id"])
        if table == "workspace_channels" and "name" not in filters and "last_message_preview" not in filters:
            return []
        if table == "workspace_tasks" and "title" in filters:
            return [
                {
                    "id": "task-2",
                    "workspace_id": "workspace-2",
                    "title": "Launch workspace-wide search",
                    "description": "Search across accessible workspaces",
                    "status": "active",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        return []

    monkeypatch.setattr(search, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(search, "list_user_workspaces", fake_list_user_workspaces)
    monkeypatch.setattr(search, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(search, "select_all_trusted", fake_select_all_trusted)

    result = await search.search_workspace(
        workspace_id="workspace-1",
        user_id="user-1",
        query="launch",
        scope="organization",
    )

    assert access_calls == [("workspace-1", "user-1")]
    assert list_calls == ["user-1"]
    assert ["workspace-1", "workspace-2", "workspace-3"] in searched_workspace_filters
    assert [item["workspace_id"] for item in result["tasks"]] == ["workspace-2"]


@pytest.mark.asyncio
async def test_search_workspace_organization_scope_filters_rows_outside_user_workspaces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id})

    async def fake_list_user_workspaces(user_id: str):
        return [{"id": "workspace-1"}]

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]):
        return None

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        assert filters is not None
        if table == "workspace_channels" and "name" not in filters and "last_message_preview" not in filters:
            return []
        if table == "workspace_tasks" and "title" in filters:
            assert filters["workspace_id"] == ["workspace-1"]
            return [
                {
                    "id": "task-secret",
                    "workspace_id": "workspace-secret",
                    "title": "Hidden launch",
                    "description": "Must not leak",
                    "status": "active",
                    "created_at": "2026-06-01T00:00:00+00:00",
                    "updated_at": "2026-06-03T00:00:00+00:00",
                }
            ]
        return []

    monkeypatch.setattr(search, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(search, "list_user_workspaces", fake_list_user_workspaces)
    monkeypatch.setattr(search, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(search, "select_all_trusted", fake_select_all_trusted)

    result = await search.search_workspace(
        workspace_id="workspace-1",
        user_id="user-1",
        query="launch",
        scope="organization",
    )

    assert result["tasks"] == []
