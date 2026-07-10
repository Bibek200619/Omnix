from __future__ import annotations

import logging
from typing import Any

import pytest

from app.bootstrap import middleware


def _empty_metrics() -> dict[str, int | str | None]:
    return {
        "enqueued_total": 0,
        "written_total": 0,
        "failed_total": 0,
        "dropped_total": 0,
        "last_failure_at": None,
        "last_drop_at": None,
    }


def _log_payload() -> dict[str, Any]:
    return {
        "endpoint": "/health/test",
        "status": 200,
        "response_time_ms": 1.5,
        "user_id": None,
        "created_at": "2026-07-10T00:00:00+00:00",
    }


def test_api_logging_health_reports_saturated_drops(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    pending = {object() for _ in range(middleware._MAX_BACKGROUND_LOG_TASKS)}
    monkeypatch.setattr(middleware, "_background_tasks", pending)
    monkeypatch.setattr(middleware, "_api_log_metrics", _empty_metrics())

    with caplog.at_level(logging.WARNING, logger=middleware.__name__):
        middleware._fire_and_forget_log(_log_payload())

    health = middleware.get_api_logging_health()
    assert health["status"] == "degraded"
    assert health["pending_tasks"] == middleware._MAX_BACKGROUND_LOG_TASKS
    assert health["dropped_total"] == 1
    assert health["enqueued_total"] == 0
    assert health["last_drop_at"] is not None
    assert "backlog saturated" in caplog.text


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
