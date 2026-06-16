from __future__ import annotations

import pytest

from app.bootstrap import shutdown
from app.runtime.manager import RuntimeManager


def _reset_runtime() -> RuntimeManager:
    RuntimeManager._instance = None
    return RuntimeManager.get()


@pytest.mark.asyncio
async def test_drain_workers_returns_true_when_no_jobs_processing() -> None:
    runtime = _reset_runtime()
    runtime.register_worker("ingestion_worker_main", ["ingest_file"], worker_type="ingestion")

    assert await shutdown.drain_workers(timeout_seconds=0.01) is True


@pytest.mark.asyncio
async def test_drain_workers_times_out_when_jobs_keep_processing() -> None:
    runtime = _reset_runtime()
    runtime.register_worker("ingestion_worker_main", ["ingest_file"], worker_type="ingestion")
    runtime.record_job_started("ingestion_worker_main")

    assert await shutdown.drain_workers(timeout_seconds=0) is False
