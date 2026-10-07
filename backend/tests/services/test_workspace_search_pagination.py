from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.services import workspace_search_service as search


def ranked_rows(count: int) -> list[dict[str, Any]]:
    # Deliberately mix domains and invert recency relative to database relevance.
    types = ("source", "task", "decision", "file", "initiative", "document")
    return [
        {
            "id": f"result-{index}",
            "workspace_id": "workspace-1",
            "type": types[index % len(types)],
            "title": f"Release evidence {index}",
            "url": f"/files?id=file-{index}",
            "updated_at": f"{2020 + index}-01-01T00:00:00+00:00",
        }
        for index in range(count)
    ]


@pytest.fixture
def configure_search(monkeypatch: pytest.MonkeyPatch):
    def configure(rows: list[dict[str, Any]], *, supplemental: bool = False):
        calls: list[dict[str, Any]] = []
        auxiliary_calls: list[str] = []

        async def access(workspace_id: str, user_id: str):
            assert (workspace_id, user_id) == ("workspace-1", "user-1")
            workspace = {"id": workspace_id}
            if supplemental:
                workspace["name"] = "Release workspace"
            return SimpleNamespace(workspace=workspace)

        async def rpc(**kwargs: Any):
            assert kwargs["workspace_id"] == "workspace-1"
            assert kwargs["query"] == "release"
            calls.append(kwargs)
            return rows[kwargs["cursor"] : kwargs["cursor"] + kwargs["limit"]]

        def auxiliary(group: str):
            async def results(*args: Any):
                auxiliary_calls.append(group)
                if not supplemental:
                    return []
                return [{"id": group, "type": group, "title": "Release supplement"}]

            return results

        monkeypatch.setattr(search, "require_workspace_access", access)
        monkeypatch.setattr(search, "_search_ranked_workspace", rpc)
        monkeypatch.setattr(search, "_search_conversations", auxiliary("conversations"))
        monkeypatch.setattr(search, "_search_members", auxiliary("members"))
        monkeypatch.setattr(search, "_search_mentions", auxiliary("mentions"))
        return calls, auxiliary_calls

    return configure


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 1, 8, 9, 16, 53, 257])
async def test_ranked_pages_are_disjoint_lossless_and_keep_database_order(
    configure_search, count: int
) -> None:
    rows = ranked_rows(count)
    calls, _ = configure_search(rows)
    collected: list[str] = []
    cursor = 0
    while True:
        response = await search.search_workspace(
            workspace_id="workspace-1",
            user_id="user-1",
            query="release",
            limit=8,
            cursor=cursor,
        )
        expected = rows[cursor : cursor + 8]
        expected_ids = [row["id"] for row in expected]
        page_ids = [row["id"] for row in response["items"]]
        assert page_ids == expected_ids
        assert not set(page_ids).intersection(collected)
        collected.extend(page_ids)
        for result_type, group in (
            ("source", "sources"),
            ("task", "tasks"),
            ("decision", "decisions"),
            ("file", "files"),
            ("initiative", "initiatives"),
            ("document", "documents"),
        ):
            assert [item["id"] for item in response[group]] == [
                row["id"] for row in expected if row["type"] == result_type
            ]
        next_cursor = response["pagination"]["next_cursor"]
        assert next_cursor == (cursor + 8 if count > cursor + 8 else None)
        if next_cursor is None:
            break
        cursor = next_cursor
    assert collected == [row["id"] for row in rows]
    assert all(call["limit"] <= 9 for call in calls)


@pytest.mark.asyncio
async def test_supplemental_groups_are_returned_and_queried_only_on_first_page(
    configure_search,
) -> None:
    _, auxiliary_calls = configure_search(ranked_rows(5), supplemental=True)
    first = await search.search_workspace(
        workspace_id="workspace-1", user_id="user-1", query="release", limit=2
    )
    second = await search.search_workspace(
        workspace_id="workspace-1", user_id="user-1", query="release", limit=2, cursor=2
    )
    for group in ("conversations", "members", "mentions", "workspaces"):
        assert first[group]
        assert second[group] == []
    assert auxiliary_calls == ["conversations", "members", "mentions"]
    assert [item["id"] for item in second["items"]] == ["result-2", "result-3"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("limit", "expected_limit"), [(-4, 1), (0, 1), (25, 25), (1000, 25)]
)
async def test_page_limits_and_negative_cursor_are_bounded(
    configure_search, limit: int, expected_limit: int
) -> None:
    calls, _ = configure_search(ranked_rows(100))
    response = await search.search_workspace(
        workspace_id="workspace-1",
        user_id="user-1",
        query="release",
        limit=limit,
        cursor=-7,
    )
    assert len(response["items"]) == expected_limit
    assert response["pagination"] == {
        "limit": expected_limit,
        "cursor": 0,
        "next_cursor": expected_limit,
    }
    assert calls[0]["limit"] <= expected_limit + 1
    assert calls[0]["cursor"] == 0


@pytest.mark.asyncio
async def test_cursor_past_end_returns_no_results_or_repeated_supplements(
    configure_search,
) -> None:
    _, auxiliary_calls = configure_search(ranked_rows(4), supplemental=True)
    response = await search.search_workspace(
        workspace_id="workspace-1",
        user_id="user-1",
        query="release",
        limit=8,
        cursor=100,
    )
    assert response["items"] == []
    assert response["pagination"] == {"limit": 8, "cursor": 100, "next_cursor": None}
    assert auxiliary_calls == []


@pytest.mark.asyncio
async def test_rejected_destinations_do_not_leak_or_shift_raw_cursor(
    configure_search,
) -> None:
    rows = ranked_rows(4)
    rows[0].update(type="job", preview="private internal payload")
    rows[1].update(type="document", url="https://untrusted.example/files?id=file-1")
    configure_search(rows)
    first = await search.search_workspace(
        workspace_id="workspace-1", user_id="user-1", query="release", limit=2
    )
    assert first["items"] == []
    assert "private internal payload" not in str(first)
    assert first["pagination"]["next_cursor"] == 2
    second = await search.search_workspace(
        workspace_id="workspace-1", user_id="user-1", query="release", limit=2, cursor=2
    )
    assert [item["id"] for item in second["items"]] == ["result-2", "result-3"]
    assert second["pagination"]["next_cursor"] is None
