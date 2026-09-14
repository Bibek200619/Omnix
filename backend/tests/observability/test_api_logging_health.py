from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.bootstrap import middleware


def _empty_metrics() -> dict[str, int | str | None]:
    return {
        "enqueued_total": 0,
        "written_total": 0,
        "failed_total": 0,
        "backpressured_total": 0,
        "last_failure_at": None,
        "last_backpressure_at": None,
    }


def _log_payload() -> dict[str, Any]:
    return {
        "endpoint": "/health/test",
        "status": 200,
        "response_time_ms": 1.5,
        "user_id": None,
        "created_at": "2026-07-10T00:00:00+00:00",
    }


@pytest.mark.asyncio
async def test_api_logging_backpressures_instead_of_dropping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release_write = asyncio.Event()
    write_started = asyncio.Event()

    async def slow_write(_: dict[str, Any]) -> None:
        write_started.set()
        await release_write.wait()

    monkeypatch.setattr(middleware, "_MAX_BACKGROUND_LOG_TASKS", 1)
    monkeypatch.setattr(middleware, "_background_tasks", set())
    monkeypatch.setattr(middleware, "_api_log_metrics", _empty_metrics())
    monkeypatch.setattr(middleware, "_write_api_log", slow_write)

    await middleware._enqueue_api_log(_log_payload())
    await asyncio.wait_for(write_started.wait(), timeout=1)

    second_enqueue = asyncio.create_task(middleware._enqueue_api_log(_log_payload()))
    await asyncio.sleep(0)

    health = middleware.get_api_logging_health()
    assert second_enqueue.done() is False
    assert health["status"] == "warning"
    assert health["pending_tasks"] == middleware._MAX_BACKGROUND_LOG_TASKS
    assert health["backpressured_total"] == 1
    assert health["enqueued_total"] == 1
    assert health["last_backpressure_at"] is not None
    assert "dropped_total" not in health

    release_write.set()
    await second_enqueue
    await asyncio.gather(*tuple(middleware._background_tasks))

    health = middleware.get_api_logging_health()
    assert health["pending_tasks"] == 0
    assert health["enqueued_total"] == 2
    assert health["backpressured_total"] == 1


@pytest.mark.asyncio
async def test_api_logging_health_reports_storage_write_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(middleware, "_background_tasks", set())
    monkeypatch.setattr(middleware, "_api_log_metrics", _empty_metrics())
    monkeypatch.setattr(middleware, "_insert_api_log_sync", lambda payload: False)

    await middleware._write_api_log(_log_payload())

    health = middleware.get_api_logging_health()
    assert health["status"] == "degraded"
    assert health["failed_total"] == 1
    assert health["written_total"] == 0
    assert health["last_failure_at"] is not None
