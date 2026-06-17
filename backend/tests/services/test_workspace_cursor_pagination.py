from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from app.services import workspace_decision_service as decisions
from app.services import workspace_initiative_service as initiatives
from app.services import workspace_task_service as tasks


def _cursor_for(row: dict[str, Any]) -> str:
    raw = f"{row['updated_at']}:{row['id']}"
    return base64.b64encode(raw.encode("utf-8")).decode("ascii")


def _page_source(rows: list[dict[str, Any]], filters: dict[str, Any], limit: int | None) -> list[dict[str, Any]]:
    filtered = rows
    updated_at_filter = filters.get("updated_at")
    if isinstance(updated_at_filter, dict) and updated_at_filter.get("lt"):
        cursor_updated_at = str(updated_at_filter["lt"])
        filtered = [row for row in filtered if str(row["updated_at"]) < cursor_updated_at]
    return [dict(row) for row in filtered[: limit or len(filtered)]]


async def _assert_three_pages(
    fetch_page: Callable[..., Awaitable[dict[str, Any]]],
    expected_ids: list[str],
) -> None:
    first = await fetch_page(limit=2)
    assert [item["id"] for item in first["items"]] == expected_ids[:2]
    assert first["has_more"] is True
    assert first["next_cursor"] == _cursor_for(first["items"][-1])

    second = await fetch_page(limit=2, cursor=first["next_cursor"])
    assert [item["id"] for item in second["items"]] == expected_ids[2:4]
    assert second["has_more"] is True
    assert second["next_cursor"] == _cursor_for(second["items"][-1])

    third = await fetch_page(limit=2, cursor=second["next_cursor"])
    assert [item["id"] for item in third["items"]] == expected_ids[4:]
    assert third["has_more"] is False
    assert third["next_cursor"] is None


@pytest.mark.asyncio
async def test_list_tasks_returns_cursor_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {
            "id": f"task-{index}",
            "workspace_id": "workspace-1",
            "title": f"Task {index}",
            "status": "active",
            "created_by": "user-1",
            "owner_user_id": None,
            "updated_at": f"2026-01-0{6 - index}T00:00:00+00:00",
            "blockers": [],
            "linked_context": [],
            "activity_metadata": {},
            "momentum_metadata": {},
        }
        for index in range(1, 6)
    ]
    main_limits: list[int | None] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        return None

    async def fake_select_all(table: str, columns: str, filters: dict[str, Any], **kwargs):
        if table == "workspace_tasks":
            main_limits.append(kwargs.get("limit"))
            return _page_source(rows, filters, kwargs.get("limit"))
        if table == "workspace_decision_tasks":
            return []
        return []

    async def fake_mentions_by_source(**kwargs):
        return {}

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(tasks, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(tasks, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(tasks, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(tasks, "get_profiles", fake_profiles)

    await _assert_three_pages(
        lambda **kwargs: tasks.list_tasks(workspace_id="workspace-1", user_id="user-1", **kwargs),
        ["task-1", "task-2", "task-3", "task-4", "task-5"],
    )
    assert main_limits == [3, 3, 3]


@pytest.mark.asyncio
async def test_list_decisions_returns_cursor_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {
            "id": f"decision-{index}",
            "workspace_id": "workspace-1",
            "title": f"Decision {index}",
            "status": "accepted",
            "created_by": "user-1",
            "updated_at": f"2026-01-0{6 - index}T00:00:00+00:00",
        }
        for index in range(1, 6)
    ]
    main_limits: list[int | None] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        return None

    async def fake_select_all(table: str, columns: str, filters: dict[str, Any], **kwargs):
        if table == "workspace_decisions":
            main_limits.append(kwargs.get("limit"))
            return _page_source(rows, filters, kwargs.get("limit"))
        return []

    async def fake_mentions_by_source(**kwargs):
        return {}

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(decisions, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(decisions, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(decisions, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(decisions, "get_profiles", fake_profiles)

    await _assert_three_pages(
        lambda **kwargs: decisions.list_decisions(workspace_id="workspace-1", user_id="user-1", **kwargs),
        ["decision-1", "decision-2", "decision-3", "decision-4", "decision-5"],
    )
    assert main_limits == [3, 3, 3]


@pytest.mark.asyncio
async def test_list_initiatives_returns_cursor_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {
            "id": f"initiative-{index}",
            "workspace_id": "workspace-1",
            "title": f"Initiative {index}",
            "status": "active",
            "created_by": "user-1",
            "updated_at": f"2026-01-0{6 - index}T00:00:00+00:00",
            "linked_resources": [],
            "activity_metadata": {},
        }
        for index in range(1, 6)
    ]
    main_limits: list[int | None] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        return None

    async def fake_select_all(table: str, columns: str, filters: dict[str, Any], **kwargs):
        if table == "workspace_initiatives":
            main_limits.append(kwargs.get("limit"))
            return _page_source(rows, filters, kwargs.get("limit"))
        if table == "workspace_decisions":
            return []
        return []

    async def fake_base_records(workspace_id: str, user_id: str):
        return [], [], []

    async def fake_profiles(user_ids: list[str]):
        return {}

    monkeypatch.setattr(initiatives, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(initiatives, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(initiatives, "_base_records", fake_base_records)
    monkeypatch.setattr(initiatives, "get_profiles", fake_profiles)

    await _assert_three_pages(
        lambda **kwargs: initiatives.list_initiatives(workspace_id="workspace-1", user_id="user-1", **kwargs),
        ["initiative-1", "initiative-2", "initiative-3", "initiative-4", "initiative-5"],
    )
    assert main_limits == [3, 3, 3]
