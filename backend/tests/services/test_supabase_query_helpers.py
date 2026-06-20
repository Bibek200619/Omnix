from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services import supabase_service
from app.services.supabase_query_helpers import (
    apply_filters,
    select_columns_after_missing_column,
    select_recovery_attempts,
)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
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


def test_select_column_recovery_removes_missing_column() -> None:
    assert select_columns_after_missing_column(
        "profiles",
        "id,email,phone_number,created_at",
        "Could not find the 'phone_number' column of 'profiles' in the schema cache",
    ) == ("phone_number", "id,email,created_at")
    assert select_columns_after_missing_column(
        "profiles",
        "id,profiles.legacy_field,name",
        'column "profiles.legacy_field" does not exist',
    ) == ("legacy_field", "id,name")
    assert select_recovery_attempts("id,email,name") == 4


def test_supabase_service_preserves_private_helper_aliases() -> None:
    query = RecordingQuery()

    assert supabase_service._apply_filters(query, {"status": "open"}) is query
    assert query.calls == [("eq", ("status", "open"))]
    assert supabase_service._select_recovery_attempts("*") == 1


def test_supabase_service_stays_below_reviewable_size_threshold() -> None:
    assert len(SUPABASE_SERVICE.read_text(encoding="utf-8").splitlines()) <= 1_000
    assert len(QUERY_HELPERS.read_text(encoding="utf-8").splitlines()) <= 120
