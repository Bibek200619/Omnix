from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.health import checks
from app.services import supabase_service


class ProjectedJobQuery:
    """Transport fixture returns only columns the real trusted adapter requests."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.columns: list[str] = []

    def table(self, name: str) -> ProjectedJobQuery:
        assert name == "jobs"
        return self

    def select(self, columns: str) -> ProjectedJobQuery:
        self.columns = columns.split(",")
        return self

    def eq(self, column: str, value: Any) -> ProjectedJobQuery:
        self.rows = [row for row in self.rows if row.get(column) == value]
        return self

    async def execute(self) -> SimpleNamespace:
        return SimpleNamespace(
            data=[
                {column: row.get(column) for column in self.columns}
                for row in self.rows
            ]
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(("minutes", "expected"), [(10, 3), (30, 2), (60, 1)])
async def test_queued_age_counts_use_real_projected_timestamps(
    monkeypatch: pytest.MonkeyPatch, minutes: int, expected: int
) -> None:
    now = datetime.now(timezone.utc)
    rows = [
        {
            "id": f"age-{age}",
            "created_at": (now - timedelta(minutes=age)).isoformat(),
            "status": "queued",
        }
        for age in [61, 31, 11, 9]
    ]
    rows += [
        {"id": "no-timestamp", "created_at": None, "status": "queued"},
        {
            "id": "processing",
            "created_at": (now - timedelta(hours=2)).isoformat(),
            "status": "processing",
        },
    ]
    query = ProjectedJobQuery(rows)
    monkeypatch.setattr(
        supabase_service, "_async_client", AsyncMock(return_value=query)
    )
    assert await checks._count_stuck_jobs(minutes) == expected
    assert set(query.columns) == {"id", "created_at"}


@pytest.mark.asyncio
async def test_empty_projection_returns_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        supabase_service, "_async_client", AsyncMock(return_value=ProjectedJobQuery([]))
    )
    assert await checks._count_stuck_jobs(10) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "unavailable", [None, RuntimeError("test database unavailable")]
)
async def test_unavailable_diagnostics_do_not_claim_an_empty_queue(
    monkeypatch: pytest.MonkeyPatch, unavailable: None | RuntimeError
) -> None:
    select = (
        AsyncMock(return_value=None)
        if unavailable is None
        else AsyncMock(side_effect=unavailable)
    )
    monkeypatch.setattr(supabase_service, "select_all_trusted", select)
    assert await checks._count_stuck_jobs(10) is None
