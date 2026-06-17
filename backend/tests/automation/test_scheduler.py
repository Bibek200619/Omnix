from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.automation import scheduler


@pytest.mark.asyncio
async def test_run_automation_once_times_out_and_cancels(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    cancelled = False
    updates: list[dict[str, Any]] = []

    async def slow_job(automation: dict[str, Any]):
        nonlocal cancelled
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled = True
            raise

    async def fake_update(*args, **kwargs):
        updates.append({"args": args, "kwargs": kwargs})

    monkeypatch.setattr(scheduler, "_automation_timeout_seconds", lambda interval_seconds: 0.01, raising=False)
    monkeypatch.setattr("app.automation.workspace_jobs.run_automation_job", slow_job)
    monkeypatch.setattr(scheduler, "update_one_trusted", fake_update, raising=False)
    caplog.set_level(logging.CRITICAL, logger=scheduler.logger.name)

    await scheduler._run_automation_once(
        "automation-1",
        60,
        {"id": "automation-1", "workspace_id": "workspace-1", "name": "Slow automation"},
    )

    assert cancelled is True
    assert updates == []
    assert "timed out" in caplog.text


@pytest.mark.asyncio
async def test_run_automation_once_updates_last_run_after_success(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fast_job(automation: dict[str, Any]):
        return {"status": "completed"}

    async def fake_update(table: str, filters: dict[str, Any], payload: dict[str, Any]):
        captured["table"] = table
        captured["filters"] = filters
        captured["payload"] = payload
        return {**filters, **payload}

    monkeypatch.setattr(scheduler, "_automation_timeout_seconds", lambda interval_seconds: 1.0, raising=False)
    monkeypatch.setattr("app.automation.workspace_jobs.run_automation_job", fast_job)
    monkeypatch.setattr(scheduler, "update_one_trusted", fake_update, raising=False)

    await scheduler._run_automation_once(
        "automation-1",
        60,
        {"id": "automation-1", "workspace_id": "workspace-1", "name": "Fast automation"},
    )

    assert captured["table"] == "automations"
    assert captured["filters"] == {"id": "automation-1", "workspace_id": "workspace-1"}
    assert "last_run_at" in captured["payload"]
    assert captured["payload"]["updated_at"] == captured["payload"]["last_run_at"]


@pytest.mark.asyncio
async def test_start_delays_recently_run_automation_until_next_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    automation = {
        "id": "automation-1",
        "workspace_id": "workspace-1",
        "name": "Recently run automation",
        "job_type": "workspace_digest",
        "schedule": None,
        "interval_seconds": 60,
        "enabled": True,
        "user_id": "user-1",
        "last_run_at": (now - timedelta(seconds=30)).isoformat(),
    }
    selected_columns: list[str] = []
    captured_delays: dict[str, float] = {}

    async def fake_select(table: str, columns: str, *args, **kwargs):
        selected_columns.append(columns)
        return [automation]

    async def fake_run_periodic(
        self,
        key: str,
        interval_seconds: int,
        automation_payload: dict[str, Any],
        *,
        initial_delay: float = 0.0,
    ) -> None:
        captured_delays[key] = initial_delay

    monkeypatch.setattr(scheduler, "select_all_trusted", fake_select, raising=False)
    monkeypatch.setattr(scheduler.AutomationScheduler, "_run_periodic", fake_run_periodic, raising=False)

    instance = scheduler.AutomationScheduler()
    await instance.start()
    await asyncio.sleep(0)

    assert "last_run_at" in selected_columns[0]
    assert captured_delays["automation-1"] == pytest.approx(30.0, abs=1.0)


@pytest.mark.asyncio
async def test_run_now_updates_last_run_after_success(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fast_job(automation: dict[str, Any]):
        return {"status": "completed"}

    async def fake_update(table: str, filters: dict[str, Any], payload: dict[str, Any]):
        captured["table"] = table
        captured["filters"] = filters
        captured["payload"] = payload
        return {**filters, **payload}

    monkeypatch.setattr("app.automation.workspace_jobs.run_automation_job", fast_job)
    monkeypatch.setattr(scheduler, "update_one_trusted", fake_update, raising=False)

    instance = scheduler.AutomationScheduler()
    await instance.run_now(
        {"id": "automation-1", "workspace_id": "workspace-1", "name": "Manual automation"},
    )

    assert captured["table"] == "automations"
    assert captured["filters"] == {"id": "automation-1", "workspace_id": "workspace-1"}
    assert "last_run_at" in captured["payload"]
