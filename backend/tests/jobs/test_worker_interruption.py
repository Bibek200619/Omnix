from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.jobs import worker
from app.runtime.manager import RuntimeManager


@dataclass
class JobState:
    row: dict[str, Any] = field(
        default_factory=lambda: {
            "id": "job-1",
            "type": "ingest_file",
            "status": "queued",
            "attempts": 0,
            "payload": {"_queue": "omnix:jobs", "file_id": "private-file"},
        }
    )
    updates: list[dict[str, Any]] = field(default_factory=list)
    pushes: list[tuple[str, str | None]] = field(default_factory=list)
    started: asyncio.Event = field(default_factory=asyncio.Event)
    stopped: asyncio.Event = field(default_factory=asyncio.Event)

    async def select(self, table: str, columns: str, filters: dict[str, Any]):
        assert table == "jobs"
        return dict(self.row)

    async def update(self, table: str, filters: dict[str, Any], values: dict[str, Any]):
        assert table == "jobs"
        self.updates.append({"filters": dict(filters), "values": dict(values)})
        if not all(self.row.get(key) == value for key, value in filters.items()):
            return None
        self.row.update(values)
        return dict(self.row)

    async def push(self, job_id: str, *, queue_name: str | None = None):
        # A second worker must not start while the interrupted handler is running.
        assert self.stopped.is_set()
        self.pushes.append((job_id, queue_name))

    async def handle(self, row: dict[str, Any]):
        self.started.set()
        try:
            await asyncio.Event().wait()
        finally:
            self.stopped.set()


@pytest.fixture
def state(monkeypatch: pytest.MonkeyPatch):
    value = JobState()
    monkeypatch.setenv("OMNIX_JOB_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("OMNIX_WORKER_ID", "interruption-test")
    monkeypatch.setattr(RuntimeManager, "_instance", None)
    RuntimeManager.get().register_worker("interruption-test", ["ingest_file"])
    monkeypatch.setattr(worker, "select_one_trusted", value.select)
    monkeypatch.setattr(worker, "update_one_trusted", value.update)
    monkeypatch.setattr(worker, "_push_retry_job", value.push)
    monkeypatch.setattr(worker, "handle_ingest_file", value.handle)
    return value


async def cancel_active(state: JobState):
    task = asyncio.create_task(
        worker._process_job_with_timeout("job-1", timeout_seconds=10)
    )
    await asyncio.wait_for(state.started.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
@pytest.mark.parametrize("queue", ["omnix:jobs", "omnix:ocr"])
async def test_shutdown_recovers_the_owned_claim_and_original_queue(state, queue):
    state.row["payload"]["_queue"] = queue
    task = asyncio.create_task(
        worker._process_job_with_timeout("job-1", timeout_seconds=10)
    )
    await asyncio.wait_for(state.started.wait(), timeout=1)
    tasks = {task}

    await worker._drain_in_flight_jobs(tasks, timeout_seconds=0.01)

    assert task.cancelled()
    assert not tasks
    assert state.row["status"] == "queued"
    assert state.row["attempts"] == 1
    assert state.row["result"]["attempt"] == 1
    assert state.pushes == [("job-1", queue)]
    assert state.updates[-1]["filters"] == {
        "id": "job-1",
        "status": "processing",
        "attempts": 1,
    }
    assert RuntimeManager.get()._jobs_processing == 0
    assert RuntimeManager.get()._jobs_failed == 1


@pytest.mark.asyncio
async def test_interrupted_final_attempt_is_dead_lettered(state):
    state.row["attempts"] = 2
    await cancel_active(state)

    assert state.row["status"] == "dead_lettered"
    assert state.row["result"]["retryable"] is False
    assert state.row["result"]["attempt"] == 3
    assert not state.pushes


@pytest.mark.asyncio
async def test_timeout_recovers_exactly_once_with_deadline_diagnostics(state):
    await worker._process_job_with_timeout("job-1", timeout_seconds=0.01)

    assert state.stopped.is_set()
    assert state.row["status"] == "queued"
    assert state.row["error"] == "Job exceeded timeout of 0.01s"
    assert state.row["attempts"] == 1
    assert len(state.updates) == 2
    assert state.pushes == [("job-1", "omnix:jobs")]


@pytest.mark.asyncio
async def test_cancel_before_claim_does_not_mutate_the_job(state, monkeypatch):
    selecting = asyncio.Event()

    async def blocked_select(*args, **kwargs):
        selecting.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(worker, "select_one_trusted", blocked_select)
    task = asyncio.create_task(
        worker._process_job_with_timeout("job-1", timeout_seconds=10)
    )
    await asyncio.wait_for(selecting.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert state.row["status"] == "queued"
    assert not state.updates
    assert not state.pushes


@pytest.mark.asyncio
async def test_timeout_before_claim_cannot_requeue_another_workers_job(
    state, monkeypatch
):
    state.row.update(status="processing", attempts=2)

    async def blocked_select(*args, **kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(worker, "select_one_trusted", blocked_select)
    await worker._process_job_with_timeout("job-1", timeout_seconds=0.01)

    assert state.row["status"] == "processing"
    assert state.row["attempts"] == 2
    assert not state.updates
    assert not state.pushes


@pytest.mark.asyncio
async def test_duplicate_delivery_that_loses_claim_does_not_run_or_retry(state):
    state.row.update(status="processing", attempts=2)
    await worker._process_job_with_timeout("job-1", timeout_seconds=0.01)

    assert not state.started.is_set()
    assert state.row["status"] == "processing"
    assert state.row["attempts"] == 2
    assert not state.pushes


@pytest.mark.asyncio
@pytest.mark.parametrize("status,attempt", [("completed", 1), ("processing", 2)])
async def test_changed_claim_is_not_overwritten_by_interruption(state, status, attempt):
    task = asyncio.create_task(
        worker._process_job_with_timeout("job-1", timeout_seconds=10)
    )
    await asyncio.wait_for(state.started.wait(), timeout=1)
    state.row.update(status=status, attempts=attempt)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert state.row["status"] == status
    assert state.row["attempts"] == attempt
    assert not state.pushes


@pytest.mark.asyncio
async def test_redis_failure_leaves_the_interrupted_job_durably_queued(
    state, monkeypatch
):
    async def fail_push(*args, **kwargs):
        raise ConnectionError("Redis unavailable")

    monkeypatch.setattr(worker, "_push_retry_job", fail_push)
    await cancel_active(state)

    assert state.row["status"] == "queued"
    assert state.row["result"]["retryable"] is True


@pytest.mark.asyncio
async def test_failed_recovery_remains_unresolved_without_leaking_error_details(
    state, monkeypatch, caplog
):
    update = state.update

    async def fail_recovery(table, filters, values):
        if values["status"] != "processing":
            raise RuntimeError("private-database-detail")
        return await update(table, filters, values)

    monkeypatch.setattr(worker, "update_one_trusted", fail_recovery)
    await cancel_active(state)

    assert state.row["status"] == "processing"
    assert not state.pushes
    assert "claim remains unresolved" in caplog.text
    assert "private-database-detail" not in caplog.text


@pytest.mark.asyncio
async def test_restarted_processor_can_complete_the_interrupted_job(state, monkeypatch):
    await cancel_active(state)

    async def complete(row):
        return {"status": "completed", "chunks": 2}

    monkeypatch.setattr(worker, "handle_ingest_file", complete)
    await worker._process_job_with_timeout("job-1", timeout_seconds=1)

    assert state.row["status"] == "completed"
    assert state.row["attempts"] == 2
    assert state.row["result"]["chunks"] == 2
    assert state.pushes == [("job-1", "omnix:jobs")]
