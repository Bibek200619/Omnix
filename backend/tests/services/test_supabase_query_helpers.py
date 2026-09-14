from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import supabase_service
from app.services.supabase_query_helpers import apply_filters

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"
SUPABASE_SERVICE = BACKEND_ROOT / "app" / "services" / "supabase_service.py"
QUERY_HELPERS = BACKEND_ROOT / "app" / "services" / "supabase_query_helpers.py"


class RecordingQuery:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def eq(self, *args: Any) -> "RecordingQuery":
        self.calls.append(("eq", args))
        return self

    def in_(self, *args: Any) -> "RecordingQuery":
        self.calls.append(("in_", args))
        return self

    def lt(self, *args: Any) -> "RecordingQuery":
        self.calls.append(("lt", args))
        return self

    def gte(self, *args: Any) -> "RecordingQuery":
        self.calls.append(("gte", args))
        return self

    def ilike(self, *args: Any) -> "RecordingQuery":
        self.calls.append(("ilike", args))
        return self


def test_apply_filters_maps_supported_operator_filters() -> None:
    query = RecordingQuery()

    result = apply_filters(
        query,
        {
            "workspace_id": ["workspace-1", "workspace-2"],
            "created_at": {"gte": "2026-01-01", "lt": "2026-02-01"},
            "title": {"ilike": "%roadmap%"},
            "status": "open",
        },
    )

    assert result is query
    assert query.calls == [
        ("in_", ("workspace_id", ["workspace-1", "workspace-2"])),
        ("gte", ("created_at", "2026-01-01")),
        ("lt", ("created_at", "2026-02-01")),
        ("ilike", ("title", "%roadmap%")),
        ("eq", ("status", "open")),
    ]


def test_supabase_service_exposes_filter_helper_without_schema_recovery_aliases() -> None:
    query = RecordingQuery()

    assert supabase_service._apply_filters(query, {"status": "open"}) is query
    assert query.calls == [("eq", ("status", "open"))]
    assert not hasattr(supabase_service, "_select_columns_after_missing_column")
    assert not hasattr(supabase_service, "_select_recovery_attempts")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("operation", "args"),
    [
        (supabase_service.select_all_trusted, ("records", "id")),
        (supabase_service.select_one_trusted, ("records", "id", {})),
        (supabase_service.update_one_trusted, ("records", {}, {"status": "ready"})),
        (supabase_service.update_many_trusted, ("records", {}, {"status": "ready"})),
        (supabase_service.delete_one_trusted, ("records", {})),
        (supabase_service.delete_many_trusted, ("records", {})),
    ],
)
async def test_async_trusted_operations_reject_implicit_full_table_scope(
    monkeypatch: pytest.MonkeyPatch,
    operation: Any,
    args: tuple[Any, ...],
) -> None:
    async def fail_async_client() -> Any:
        raise AssertionError("rejected operations must not reach the service-role client")

    monkeypatch.setattr(supabase_service, "_async_client", fail_async_client)

    with pytest.raises(supabase_service.SupabaseServiceError, match="Internal server error"):
        await operation(*args)


@pytest.mark.parametrize(
    ("operation", "args"),
    [
        (supabase_service._select_all_trusted_sync, ("records", "id")),
        (supabase_service._select_one_trusted_sync, ("records", "id", {})),
        (supabase_service._update_one_trusted_sync, ("records", {}, {"status": "ready"})),
        (supabase_service._delete_many_trusted_sync, ("records", {})),
    ],
)
def test_sync_trusted_operations_reject_implicit_full_table_scope(
    monkeypatch: pytest.MonkeyPatch,
    operation: Any,
    args: tuple[Any, ...],
) -> None:
    def fail_client() -> Any:
        raise AssertionError("rejected operations must not reach the service-role client")

    monkeypatch.setattr(supabase_service, "get_supabase", fail_client)

    with pytest.raises(supabase_service.SupabaseServiceError, match="Internal server error"):
        operation(*args)


@pytest.mark.asyncio
async def test_named_system_read_can_use_explicit_unscoped_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class EmptyQuery:
        def select(self, _columns: str) -> "EmptyQuery":
            return self

        async def execute(self) -> SimpleNamespace:
            return SimpleNamespace(data=[])

    class EmptyClient:
        def table(self, _table: str) -> EmptyQuery:
            return EmptyQuery()

    async def fake_async_client() -> EmptyClient:
        return EmptyClient()

    monkeypatch.setattr(supabase_service, "_async_client", fake_async_client)

    rows = await supabase_service.select_all_trusted(
        "records",
        "id",
        unscoped_reason="focused_system_test",
    )

    assert rows == []


def test_repository_has_no_implicit_unscoped_trusted_reads() -> None:
    implicit_reads: list[str] = []
    explicit_system_reads: set[tuple[str, str]] = set()

    for path in sorted(APP_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        relative_path = str(path.relative_to(APP_ROOT))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            function_name = (
                node.func.id
                if isinstance(node.func, ast.Name)
                else node.func.attr
                if isinstance(node.func, ast.Attribute)
                else ""
            )
            if function_name != "select_all_trusted":
                continue

            filter_node = node.args[2] if len(node.args) >= 3 else None
            reason_node = None
            for keyword in node.keywords:
                if keyword.arg == "filters":
                    filter_node = keyword.value
                elif keyword.arg == "unscoped_reason":
                    reason_node = keyword.value

            has_filter = filter_node is not None and not (
                isinstance(filter_node, ast.Constant) and filter_node.value is None
            ) and not (
                isinstance(filter_node, ast.Dict) and not filter_node.keys
            )
            reason = (
                reason_node.value
                if isinstance(reason_node, ast.Constant)
                and isinstance(reason_node.value, str)
                and reason_node.value.strip()
                else None
            )
            if has_filter:
                continue
            if reason is None:
                implicit_reads.append(f"{relative_path}:{node.lineno}")
            else:
                explicit_system_reads.add((relative_path, reason))

    assert implicit_reads == []
    assert explicit_system_reads == {
        ("automation/scheduler.py", "automation_scheduler_startup"),
        ("jobs/preflight.py", "startup_embedding_contract_sample"),
        ("jobs/reembed_jobs.py", "reembedding_batch_scan"),
    }


def test_supabase_service_stays_below_reviewable_size_threshold() -> None:
    assert len(SUPABASE_SERVICE.read_text(encoding="utf-8").splitlines()) <= 1_000
    assert len(QUERY_HELPERS.read_text(encoding="utf-8").splitlines()) <= 120
