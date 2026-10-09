from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.automation import scheduler as scheduler_module
from app.automation import workspace_jobs
from app.services import workspace_service


def automation(**changes):
    return {
        "id": "automation-1",
        "workspace_id": "workspace-1",
        "user_id": "owner-1",
        "name": "Original",
        "job_type": "daily_summary",
        "interval_seconds": 300,
        "enabled": True,
        **changes,
    }


async def eventually(predicate):
    async def wait():
        while not predicate():
            await asyncio.sleep(0.001)

    await asyncio.wait_for(wait(), timeout=1)


async def refresh(state):
    before = state.reads
    await eventually(lambda: state.reads >= before + 2)


@pytest_asyncio.fixture
async def state(monkeypatch):
    state = SimpleNamespace(
        rows=[],
        reads=0,
        now=0.0,
        runs=[],
        builtins=[],
        checked=[],
        query_error=None,
        denied=False,
        block=None,
        released=[],
        runner_error=None,
        scheduler=scheduler_module.AutomationScheduler(),
    )

    async def select(table, columns, **kwargs):
        assert table == "automations"
        assert {"id", "workspace_id", "user_id", "enabled", "interval_seconds"} <= set(
            columns.split(",")
        )
        state.reads += 1
        if state.query_error:
            raise state.query_error
        return deepcopy(state.rows)

    async def access(workspace_id, user_id):
        state.checked.append((workspace_id, user_id))
        if state.denied:
            raise HTTPException(status_code=404, detail="private membership error")

    async def run(row):
        if row.get("name") == "System Presence Cleanup":
            state.builtins.append(deepcopy(row))
            return {"cleaned_count": 0}
        state.runs.append(deepcopy(row))
        if state.runner_error:
            raise state.runner_error
        if state.block is not None:
            try:
                await state.block.wait()
            finally:
                state.released.append(row.get("id"))
        return {"artifact": {"id": "artifact-1"}}

    monkeypatch.setattr(scheduler_module, "select_all_trusted", select)
    monkeypatch.setattr(scheduler_module, "monotonic", lambda: state.now, raising=False)
    monkeypatch.setattr(
        scheduler_module.AutomationScheduler, "_REFRESH_SECONDS", 0.001, raising=False
    )
    monkeypatch.setattr(workspace_jobs, "run_automation_job", run)
    monkeypatch.setattr(workspace_service, "require_workspace_access", access)
    yield state
    await state.scheduler.stop()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_new_and_reenabled_automations_are_observed_without_restart(state):
    await state.scheduler.start()
    await eventually(lambda: state.reads >= 1)
    state.rows = [automation()]
    await eventually(lambda: len(state.runs) == 1)
    state.rows[0]["enabled"] = False
    await refresh(state)
    state.rows[0]["enabled"] = True
    await eventually(lambda: len(state.runs) == 2)
    assert state.checked == [("workspace-1", "owner-1")] * 2


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["disable", "delete", "zero_interval"])
async def test_removing_a_schedule_prevents_future_execution(state, change):
    state.rows = [automation()]
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    if change == "delete":
        state.rows = []
    elif change == "disable":
        state.rows[0]["enabled"] = False
    else:
        state.rows[0]["interval_seconds"] = 0
    state.now = 1000
    await refresh(state)
    assert len(state.runs) == 1
    assert not state.scheduler._running


@pytest.mark.asyncio
async def test_due_execution_uses_current_record_not_startup_snapshot(state):
    state.rows = [automation()]
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    state.rows[0].update(name="Edited", schedule={"version": 2}, user_id="new-owner")
    state.now = 300
    await eventually(lambda: len(state.runs) == 2)
    assert state.runs[-1]["name"] == "Edited"
    assert state.runs[-1]["schedule"] == {"version": 2}
    assert state.checked[-1] == ("workspace-1", "new-owner")


@pytest.mark.asyncio
@pytest.mark.parametrize("interval", [10, 600])
async def test_interval_edits_reset_future_deadline(state, interval):
    state.rows = [automation()]
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    state.now = 5
    state.rows[0]["interval_seconds"] = interval
    await refresh(state)
    state.now = 5 + interval - 1
    await refresh(state)
    assert len(state.runs) == 1
    state.now = 5 + interval
    await eventually(lambda: len(state.runs) == 2)


@pytest.mark.asyncio
async def test_failed_refresh_dispatches_no_cached_rows_and_recovers(state, caplog):
    state.rows = [automation()]
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    state.query_error = RuntimeError("secret DB connection string")
    state.now = 300
    await refresh(state)
    assert len(state.runs) == 1
    assert "secret DB connection string" not in caplog.text
    state.rows[0]["name"] = "Recovered"
    state.query_error = None
    await eventually(lambda: len(state.runs) == 2)
    assert state.runs[-1]["name"] == "Recovered"


@pytest.mark.asyncio
async def test_startup_database_failure_does_not_stop_builtin_or_refresh(state, caplog):
    state.query_error = RuntimeError("private startup credentials")
    await state.scheduler.start()
    await eventually(lambda: len(state.builtins) == 1)
    await refresh(state)
    assert state.runs == []
    assert "private startup credentials" not in caplog.text
    state.rows = [automation()]
    state.query_error = None
    await eventually(lambda: len(state.runs) == 1)


@pytest.mark.asyncio
async def test_long_run_does_not_overlap_and_interval_begins_after_completion(state):
    state.block = asyncio.Event()
    state.rows = [automation(interval_seconds=10)]
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    state.now = 100
    await refresh(state)
    assert len(state.runs) == 1
    state.block.set()
    await eventually(lambda: bool(state.released))
    state.now = 109
    await refresh(state)
    assert len(state.runs) == 1
    state.now = 110
    await eventually(lambda: len(state.runs) == 2)


@pytest.mark.asyncio
async def test_disabling_does_not_cancel_work_already_started(state):
    state.block = asyncio.Event()
    state.rows = [automation()]
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    state.rows[0]["enabled"] = False
    await refresh(state)
    assert state.released == []
    state.block.set()
    await eventually(lambda: bool(state.released))
    state.now = 1000
    await refresh(state)
    assert len(state.runs) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {"interval_seconds": -1},
        {"interval_seconds": True},
        {"interval_seconds": 1.5},
        {"interval_seconds": "300"},
        {"interval_seconds": None},
        {"interval_seconds": 31_536_001},
        {"id": None},
        {"workspace_id": None},
        {"user_id": None},
        {"enabled": "true"},
        {"job_type": "cleanup_stale_presence"},
        {"job_type": "unsupported"},
    ],
)
async def test_invalid_or_system_only_database_schedules_never_execute(state, changes):
    state.rows = [automation(**changes)]
    await state.scheduler.start()
    await eventually(lambda: state.reads >= 1)
    await refresh(state)
    assert state.runs == []
    assert state.checked == []
    assert len(state.builtins) == 1


@pytest.mark.asyncio
async def test_revoked_owner_is_checked_before_execution_without_private_logs(
    state, caplog
):
    state.rows = [automation()]
    state.denied = True
    await state.scheduler.start()
    await eventually(lambda: bool(state.checked))
    assert state.runs == []
    assert "private membership error" not in caplog.text


@pytest.mark.asyncio
async def test_runner_failure_is_redacted_and_does_not_kill_future_schedule(
    state, caplog
):
    state.rows = [automation()]
    state.runner_error = RuntimeError("private provider prompt")
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    assert "private provider prompt" not in caplog.text
    state.runner_error = None
    state.now = 300
    await eventually(lambda: len(state.runs) == 2)


@pytest.mark.asyncio
async def test_stop_awaits_owned_task_cleanup_and_restart_executes_again(state):
    state.rows = [automation()]
    state.block = asyncio.Event()
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    await state.scheduler.stop()
    assert state.released == ["automation-1"]
    state.block = None
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 2)
    assert len(state.builtins) == 2


@pytest.mark.asyncio
async def test_start_is_idempotent_without_duplicate_builtin_or_automation(state):
    state.rows = [automation()]
    await state.scheduler.start()
    await state.scheduler.start()
    await eventually(lambda: len(state.runs) == 1)
    await refresh(state)
    assert len(state.runs) == 1
    assert len(state.builtins) == 1
