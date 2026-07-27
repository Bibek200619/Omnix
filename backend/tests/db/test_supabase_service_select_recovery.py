from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.services import supabase_service


class FakeQuery:
    def __init__(self, table: str, columns: str) -> None:
        self.table = table
        self.columns = columns
        self.filters: dict[str, Any] = {}
        self.orders: list[tuple[str, bool]] = []

    def eq(self, column: str, value: Any) -> FakeQuery:
        self.filters[column] = value
        return self

    def order(self, column: str, *, desc: bool = False, **_kwargs: Any) -> FakeQuery:
        self.orders.append((column, desc))
        return self

    def limit(self, *_args: Any, **_kwargs: Any) -> FakeQuery:
        return self

    def maybe_single(self) -> FakeQuery:
        return self


class FakeTable:
    def __init__(self, name: str) -> None:
        self.name = name

    def select(self, columns: str) -> FakeQuery:
        return FakeQuery(self.name, columns)


class FakeClient:
    def table(self, name: str) -> FakeTable:
        return FakeTable(name)


@pytest.mark.asyncio
async def test_select_all_recovers_from_multiple_schema_cache_misses(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[str] = []

    async def fake_async_client() -> FakeClient:
        return FakeClient()

    async def fake_execute(query: FakeQuery, *, operation: str = "execute", **_kwargs: Any) -> Any:
        attempts.append(query.columns)
        if "workspace_focus" in query.columns:
            raise RuntimeError("Could not find the 'workspace_focus' column of 'workspaces' in the schema cache")
        if "ai_specialization" in query.columns:
            raise RuntimeError("Could not find the 'ai_specialization' column of 'workspaces' in the schema cache")
        return SimpleNamespace(data=[{"id": "workspace-1", "user_id": "user-1", "name": "Legacy"}])

    monkeypatch.setattr(supabase_service, "_async_client", fake_async_client)
    monkeypatch.setattr(supabase_service, "_execute_with_retry_async", fake_execute)

    rows = await supabase_service.select_all(
        "workspaces",
        "id,user_id,name,workspace_focus,ai_specialization",
        filters={"user_id": "user-1"},
    )

    assert rows == [{"id": "workspace-1", "user_id": "user-1", "name": "Legacy"}]
    assert attempts == [
        "id,user_id,name,workspace_focus,ai_specialization",
        "id,user_id,name,ai_specialization",
        "id,user_id,name",
    ]


@pytest.mark.asyncio
async def test_select_all_trusted_chains_a_secondary_order(monkeypatch: pytest.MonkeyPatch) -> None:
    queries: list[FakeQuery] = []

    async def fake_async_client() -> FakeClient:
        return FakeClient()

    async def fake_execute(query: FakeQuery, *, operation: str = "execute", **_kwargs: Any) -> Any:
        queries.append(query)
        return SimpleNamespace(data=[{"id": "message-1"}])

    monkeypatch.setattr(supabase_service, "_async_client", fake_async_client)
    monkeypatch.setattr(supabase_service, "_execute_with_retry_async", fake_execute)

    rows = await supabase_service.select_all_trusted(
        "workspace_channel_messages",
        "id,created_at",
        filters={"channel_id": "channel-1"},
        order_by="created_at",
        secondary_order_by="id",
        desc=True,
    )

    assert rows == [{"id": "message-1"}]
    assert queries[0].orders == [("created_at", True), ("id", True)]
