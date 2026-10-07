from __future__ import annotations

import asyncio
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
QUEUE_FALLBACK_MIGRATION = REPO_ROOT / "supabase" / "migrations" / "0053_jobs_durable_queue_fallback_index.sql"


def _reset_runtime() -> Any:
    from app.runtime.manager import RuntimeManager

    RuntimeManager._instance = None
    return RuntimeManager.get()


def test_lazy_redis_client_is_cached_with_bounded_timeouts(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.bootstrap import redis as redis_bootstrap

    client = object()
    from_url = MagicMock(return_value=client)
    monkeypatch.setattr(redis_bootstrap, "_redis_client", None)
    monkeypatch.setattr(redis_bootstrap, "aioredis", SimpleNamespace(from_url=from_url))
    monkeypatch.setattr(
        redis_bootstrap,
        "get_settings",
        lambda: SimpleNamespace(REDIS_URL="redis://queue.example.test:6379/0"),
    )

    assert redis_bootstrap.get_redis() is client
    assert redis_bootstrap.get_redis() is client
    from_url.assert_called_once_with(
        "redis://queue.example.test:6379/0",
        decode_responses=True,
        socket_timeout=5.0,
        socket_connect_timeout=5.0,
        retry_on_timeout=True,
    )


@pytest.mark.asyncio
async def test_enqueue_bounds_redis_timeout_but_keeps_durable_job(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.jobs import queue
    import app.services.supabase_service as supabase_service

    inserted: list[dict[str, Any]] = []

    async def fake_insert(table: str, record: dict[str, Any]) -> dict[str, Any]:
        assert table == "jobs"
        inserted.append(dict(record))
        return record

    class BlockingRedis:
        async def lpush(self, queue_name: str, job_id: str) -> int:
            await asyncio.Event().wait()
            return 1

    monkeypatch.setattr(supabase_service, "insert_one_trusted", fake_insert)
    monkeypatch.setattr(queue, "get_redis", lambda: BlockingRedis())
    monkeypatch.setenv("OMNIX_REDIS_OPERATION_TIMEOUT_SECONDS", "0.1")

    started = time.monotonic()
    with pytest.raises(queue.JobEnqueueError) as error:
        await queue.enqueue_job({"type": "ingest_file", "file_id": "file-1", "user_id": "user-1"})
    elapsed = time.monotonic() - started

    assert elapsed < 0.5
    assert error.value.persisted is True
    assert inserted == [
        {
            "id": error.value.job_id,
            "type": "ingest_file",
            "status": "queued",
            "payload": {
                "type": "ingest_file",
                "file_id": "file-1",
                "user_id": "user-1",
                "_queue": "omnix:jobs",
            },
            "progress": 0,
            "attempts": 0,
        }
    ]


@pytest.mark.asyncio
async def test_durable_fallback_is_queue_scoped_and_includes_legacy_primary_jobs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.jobs import queue
    import app.services.supabase_service as supabase_service

    queries: list[dict[str, Any]] = []

    async def fake_select(
        table: str,
        columns: str,
        *,
        filters: dict[str, Any],
        order_by: str,
        limit: int,
    ) -> list[dict[str, str]]:
        assert table == "jobs"
        assert columns == "id"
        assert order_by == "created_at"
        queries.append(dict(filters))
        queue_filter = filters["payload->>_queue"]
        if queue_filter == "queue:ingestion":
            return [{"id": "normal-job"}]
        assert queue_filter == {"is": "null"}
        return [{"id": "legacy-job"}]

    monkeypatch.setenv("OMNIX_INGESTION_QUEUE", "queue:ingestion")
    monkeypatch.delenv("OMNIX_ROLE", raising=False)
    monkeypatch.setattr(supabase_service, "select_all_trusted", fake_select)

    assert await queue.queued_job_ids_for_queue(queue="queue:ingestion", limit=2) == [
        "normal-job",
        "legacy-job",
    ]
    assert queries == [
        {"status": "queued", "payload->>_queue": "queue:ingestion"},
        {"status": "queued", "payload->>_queue": {"is": "null"}},
    ]


@pytest.mark.asyncio
async def test_durable_fallback_does_not_pull_legacy_jobs_into_ocr_pool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.jobs import queue
    import app.services.supabase_service as supabase_service

    queries: list[dict[str, Any]] = []

    async def fake_select(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        queries.append(dict(kwargs["filters"]))
        return [{"id": "ocr-job"}]

    monkeypatch.setenv("OMNIX_ROLE", "ocr_worker")
    monkeypatch.setenv("OMNIX_OCR_JOB_QUEUE", "queue:ocr")
    monkeypatch.setattr(supabase_service, "select_all_trusted", fake_select)

    assert await queue.queued_job_ids_for_queue(queue="queue:ocr", limit=2) == ["ocr-job"]
    assert queries == [{"status": "queued", "payload->>_queue": "queue:ocr"}]


@pytest.mark.asyncio
async def test_worker_processes_database_fallback_after_redis_poll_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.jobs import worker

    _reset_runtime()
    shutdown_event = asyncio.Event()
    processed: list[str] = []

    class UnavailableRedis:
        async def brpop(self, queue_name: str, timeout: int) -> None:
            raise ConnectionError("Redis unavailable")

    async def fake_database_queue(*, queue: str, limit: int) -> list[str]:
        assert queue == "omnix:jobs"
        assert limit == 1
        return ["durable-job"]

    async def fake_process(job_id: str, *, claim_state=None) -> None:
        processed.append(job_id)
        shutdown_event.set()

    monkeypatch.setenv("OMNIX_WORKER_CONCURRENCY", "1")
    monkeypatch.setenv("OMNIX_WORKER_POLL_TIMEOUT_SECONDS", "1")
    monkeypatch.setenv("OMNIX_REDIS_OPERATION_TIMEOUT_SECONDS", "2")
    monkeypatch.setenv("OMNIX_WORKER_SHUTDOWN_TIMEOUT_SECONDS", "1")

    with (
        patch("app.jobs.worker.initialize_vector_store", AsyncMock(return_value=None)),
        patch("app.jobs.worker.warm_up_default_provider", AsyncMock(return_value=object())),
        patch("app.jobs.worker.get_redis", return_value=UnavailableRedis()),
        patch("app.jobs.worker.queued_job_ids_for_queue", fake_database_queue),
        patch("app.jobs.worker.shutdown_vector_store", AsyncMock(return_value=None)),
        patch("app.jobs.worker._process_job", fake_process),
    ):
        await asyncio.wait_for(worker._worker_loop(shutdown_event), timeout=2)

    assert processed == ["durable-job"]


@pytest.mark.asyncio
async def test_duplicate_delivery_executes_handler_once_after_conditional_claim() -> None:
    from app.jobs import worker

    runtime = _reset_runtime()
    runtime.register_worker(worker._WORKER_ID, [], worker_type="ingestion")
    row = {
        "id": "job-1",
        "type": "ingest_file",
        "status": "queued",
        "attempts": 0,
        "payload": {"type": "ingest_file", "file_id": "file-1", "user_id": "user-1"},
    }
    barrier = asyncio.Event()
    selects = 0
    handler_calls: list[str] = []

    async def fake_select(table: str, columns: str, filters: dict[str, str]) -> dict[str, Any]:
        nonlocal selects
        snapshot = dict(row)
        selects += 1
        if selects == 2:
            barrier.set()
        await barrier.wait()
        return snapshot

    async def fake_update(
        table: str,
        filters: dict[str, str],
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        if filters == {"id": "job-1", "status": "queued"}:
            if row["status"] != "queued":
                return None
            row.update(payload)
            return dict(row)
        row.update(payload)
        return dict(row)

    async def fake_handler(job: dict[str, Any]) -> dict[str, str]:
        handler_calls.append(str(job["id"]))
        return {"status": "completed"}

    with (
        patch("app.jobs.worker.select_one_trusted", fake_select),
        patch("app.jobs.worker.update_one_trusted", fake_update),
        patch("app.jobs.worker.handle_ingest_file", fake_handler),
    ):
        await asyncio.gather(worker._process_job("job-1"), worker._process_job("job-1"))

    assert handler_calls == ["job-1"]
    assert row["attempts"] == 1
    assert row["status"] == "completed"
    assert runtime._jobs_completed == 1
    assert runtime._jobs_failed == 0


def test_durable_queue_fallback_migration_covers_queue_scoped_oldest_first_polling() -> None:
    sql = QUEUE_FALLBACK_MIGRATION.read_text(encoding="utf-8")

    assert "idx_jobs_queued_queue_created_at" in sql
    assert "(payload->>'_queue'), created_at ASC" in sql
    assert "WHERE status = 'queued'" in sql
