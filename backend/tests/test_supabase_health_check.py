from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.health import checks


class FakeSupabaseQuery:
    def __init__(self, client: "FakeSupabaseClient", operation: str, name: str, payload: Any = None) -> None:
        self.client = client
        self.operation = operation
        self.name = name
        self.payload = payload
        self.columns: str | None = None
        self.limit_value: int | None = None

    def select(self, columns: str):
        self.operation = "select"
        self.columns = columns
        return self

    def insert(self, payload: dict[str, Any]):
        self.operation = "insert"
        self.payload = payload
        return self

    def limit(self, value: int):
        self.limit_value = value
        return self

    def execute(self):
        self.client.operations.append(
            {
                "operation": self.operation,
                "name": self.name,
                "columns": self.columns,
                "payload": self.payload,
                "limit": self.limit_value,
            }
        )
        if self.operation == "insert" and self.client.fail_write:
            raise RuntimeError("health ping insert failed")
        return SimpleNamespace(data=[{"id": "ok"}])


class FakeSupabaseTable:
    def __init__(self, client: "FakeSupabaseClient", name: str) -> None:
        self.client = client
        self.name = name

    def select(self, columns: str):
        return FakeSupabaseQuery(self.client, "select", self.name).select(columns)

    def insert(self, payload: dict[str, Any]):
        return FakeSupabaseQuery(self.client, "insert", self.name).insert(payload)


class FakeSupabaseClient:
    def __init__(self, *, fail_write: bool = False) -> None:
        self.fail_write = fail_write
        self.operations: list[dict[str, Any]] = []

    def table(self, name: str):
        return FakeSupabaseTable(self, name)

    def rpc(self, name: str, payload: dict[str, Any]):
        return FakeSupabaseQuery(self, "rpc", name, payload)


@pytest.mark.asyncio
async def test_supabase_health_verifies_read_write_and_rpc(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeSupabaseClient()
    monkeypatch.setattr(checks, "get_supabase", lambda: client)

    result = await checks.check_supabase()

    assert result["status"] == "healthy"
    assert result["checks"] == {"read": "ok", "write": "ok", "rpc": "ok"}
    assert [operation["operation"] for operation in client.operations] == ["select", "insert", "rpc"]
    assert client.operations[1]["name"] == "system_health_pings"
    assert client.operations[2]["name"] == "match_documents"


@pytest.mark.asyncio
async def test_supabase_health_reports_unhealthy_when_write_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeSupabaseClient(fail_write=True)
    monkeypatch.setattr(checks, "get_supabase", lambda: client)

    result = await checks.check_supabase()

    assert result["status"] == "unhealthy"
    assert result["failed_check"] == "write"
    assert "health ping insert failed" in result["error"]


@pytest.mark.asyncio
async def test_vector_store_health_reports_configured_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(checks, "get_configured_vector_backend", lambda: "pgvector")
    monkeypatch.setattr(checks, "get_vector_store", lambda: SimpleNamespace())

    result = await checks.check_vector_store()

    assert result["status"] == "healthy"
    assert result["vector_store"] == "pgvector"
