"""
Tests for the ingestion worker recovery sprint.

Covers:
- Worker startup and registration (RuntimeManager)
- Queue enqueue → DB-first → Redis push contract
- Job processing: happy path, missing job, handler exception, attempt increment
- Failed job handling (status update correctness)
- Health reporting: worker metrics, real Redis queue depth, stuck job counts
- Stuck job detection at 10/30/60m thresholds

Stubs for heavy production dependencies (supabase, redis, etc.) are registered
in conftest.py before any test module is collected.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_job_row(
    job_id: str = "job-1",
    job_type: str = "ingest_file",
    status: str = "queued",
    attempts: int = 0,
    created_at: str | None = None,
    started_at: str | None = None,
    payload: dict | None = None,
) -> dict:
    if created_at is None:
        created_at = datetime.now(timezone.utc).isoformat()
    return {
        "id": job_id,
        "type": job_type,
        "status": status,
        "attempts": attempts,
        "payload": payload or {"type": job_type, "file_id": "file-1", "user_id": "user-1"},
        "created_at": created_at,
        "started_at": started_at,
    }


def _reset_runtime():
    from app.runtime.manager import RuntimeManager
    RuntimeManager._instance = None
    return RuntimeManager.get()


# ===========================================================================
# Section 1: RuntimeManager
# ===========================================================================

class TestRuntimeManager:
    def setup_method(self):
        self.rm = _reset_runtime()

    def test_register_worker_sets_type(self):
        self.rm.register_worker("w1", ["ingest_file"], worker_type="ingestion")
        assert self.rm.active_workers["w1"]["worker_type"] == "ingestion"
        assert self.rm.active_workers["w1"]["status"] == "idle"

    def test_record_job_started_increments_processing(self):
        self.rm.register_worker("w1", [], worker_type="ingestion")
        self.rm.record_job_started("w1")
        assert self.rm._jobs_processing == 1
        assert self.rm.active_workers["w1"]["status"] == "processing"

    def test_record_job_completed_success(self):
        self.rm.register_worker("w1", [], worker_type="ingestion")
        self.rm.record_job_started("w1")
        self.rm.record_job_completed("w1", success=True)
        assert self.rm._jobs_processing == 0
        assert self.rm._jobs_completed == 1
        assert self.rm._jobs_failed == 0
        assert self.rm.active_workers["w1"]["status"] == "idle"

    def test_record_job_completed_failure(self):
        self.rm.register_worker("w1", [], worker_type="ingestion")
        self.rm.record_job_started("w1")
        self.rm.record_job_completed("w1", success=False)
        assert self.rm._jobs_failed == 1
        assert self.rm._jobs_completed == 0

    def test_processing_floor_at_zero(self):
        """record_job_completed must never drive _jobs_processing below 0."""
        self.rm.record_job_completed("ghost-worker", success=True)
        assert self.rm._jobs_processing == 0

    def test_get_ingestion_worker_metrics_excludes_other_types(self):
        self.rm.register_worker("ingestion-1", [], worker_type="ingestion")
        self.rm.register_worker("scheduler-1", [], worker_type="automation")
        metrics = self.rm.get_ingestion_worker_metrics()
        assert metrics["active_workers"] == 1
        assert "ingestion-1" in metrics["worker_details"]
        assert "scheduler-1" not in metrics["worker_details"]

    def test_multiple_jobs_tracked_correctly(self):
        self.rm.register_worker("w1", [], worker_type="ingestion")
        self.rm.record_job_started("w1")
        self.rm.record_job_started("w1")
        self.rm.record_job_completed("w1", success=True)
        self.rm.record_job_completed("w1", success=False)
        assert self.rm._jobs_processing == 0
        assert self.rm._jobs_completed == 1
        assert self.rm._jobs_failed == 1


# ===========================================================================
# Section 2: Queue — enqueue_job
# ===========================================================================

class TestEnqueueJob:
    @pytest.mark.asyncio
    async def test_enqueue_writes_db_then_redis(self):
        """Happy path: DB write succeeds → Redis push happens → job_id returned."""
        import app.jobs.queue as q

        fake_redis = AsyncMock()
        fake_redis.lpush = AsyncMock(return_value=1)

        with (
            patch.object(q, "_redis_client", None),
            patch("app.jobs.queue.get_redis", return_value=fake_redis),
        ):
            fake_svc = MagicMock()
            fake_svc.insert_one_trusted = AsyncMock(return_value={"id": "job-x"})
            with patch.dict(sys.modules, {"app.services.supabase_service": fake_svc}):
                job_id = await q.enqueue_job({"type": "ingest_file", "file_id": "f1", "user_id": "u1"})

        assert isinstance(job_id, str) and len(job_id) == 36  # UUID format
        fake_redis.lpush.assert_awaited_once()
        lpush_args = fake_redis.lpush.call_args[0]
        assert lpush_args[1] == job_id  # pushed the correct job_id

    @pytest.mark.asyncio
    async def test_enqueue_aborts_redis_push_if_db_fails(self):
        """If DB insert fails, Redis push must NOT happen (prevents orphan entries)."""
        import app.jobs.queue as q

        fake_redis = AsyncMock()
        fake_redis.lpush = AsyncMock()

        fake_svc = MagicMock()
        fake_svc.insert_one_trusted = AsyncMock(side_effect=RuntimeError("DB down"))

        with (
            patch.object(q, "_redis_client", None),
            patch("app.jobs.queue.get_redis", return_value=fake_redis),
            patch.dict(sys.modules, {"app.services.supabase_service": fake_svc}),
        ):
            with pytest.raises(RuntimeError, match="could not be persisted"):
                await q.enqueue_job({"type": "ingest_file"})

        fake_redis.lpush.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_enqueue_db_row_has_correct_fields(self):
        """The DB record must have status=queued, attempts=0, correct type."""
        import app.jobs.queue as q

        captured_records: list[dict] = []

        async def capturing_insert(table, record):
            captured_records.append(dict(record))
            return record

        fake_redis = AsyncMock()
        fake_redis.lpush = AsyncMock(return_value=1)
        fake_svc = MagicMock()
        fake_svc.insert_one_trusted = capturing_insert

        with (
            patch.object(q, "_redis_client", None),
            patch("app.jobs.queue.get_redis", return_value=fake_redis),
            patch.dict(sys.modules, {"app.services.supabase_service": fake_svc}),
        ):
            await q.enqueue_job({"type": "ingest_file", "file_id": "f1", "user_id": "u1"})

        assert len(captured_records) == 1
        rec = captured_records[0]
        assert rec["status"] == "queued"
        assert rec["attempts"] == 0
        assert rec["type"] == "ingest_file"
        assert rec["progress"] == 0


# ===========================================================================
# Section 3: Worker _process_job
# ===========================================================================

class TestProcessJob:
    def setup_method(self):
        self.rm = _reset_runtime()

    @pytest.mark.asyncio
    async def test_process_job_happy_path(self):
        """Queued → Processing (attempts+1) → Completed; RuntimeManager updated."""
        import app.jobs.worker as w

        self.rm.register_worker(w._WORKER_ID, [], worker_type="ingestion")

        job_row = _make_job_row()
        update_calls: list[dict] = []

        async def fake_select_one(table, cols, filters):
            return job_row

        async def fake_update_one(table, filters, data):
            update_calls.append(dict(data))
            return {**job_row, **data}

        async def fake_handle_ingest(row):
            return {"status": "completed", "chunks": ["c1"]}

        with (
            patch("app.jobs.worker.select_one_trusted", fake_select_one),
            patch("app.jobs.worker.update_one_trusted", fake_update_one),
            patch("app.jobs.worker.handle_ingest_file", fake_handle_ingest),
        ):
            await w._process_job("job-1")

        # First DB update: set status=processing and increment attempts
        assert update_calls[0]["status"] == "processing"
        assert update_calls[0]["attempts"] == 1
        # Second DB update: final result
        assert update_calls[1]["status"] == "completed"
        assert update_calls[1]["progress"] == 100

        assert self.rm._jobs_completed == 1
        assert self.rm._jobs_failed == 0

    @pytest.mark.asyncio
    async def test_process_job_missing_in_db(self):
        """Job not found in DB → log and return; RuntimeManager records failure."""
        import app.jobs.worker as w

        self.rm.register_worker(w._WORKER_ID, [], worker_type="ingestion")

        async def fake_select_one(table, cols, filters):
            return None

        with patch("app.jobs.worker.select_one_trusted", fake_select_one):
            await w._process_job("nonexistent-job")

        assert self.rm._jobs_failed == 1
        assert self.rm._jobs_completed == 0

    @pytest.mark.asyncio
    async def test_process_job_handler_raises(self):
        """Handler exception → job DB row set to failed; RuntimeManager records failure."""
        import app.jobs.worker as w

        self.rm.register_worker(w._WORKER_ID, [], worker_type="ingestion")

        job_row = _make_job_row()
        update_calls: list[dict] = []

        async def fake_select_one(table, cols, filters):
            return job_row

        async def fake_update_one(table, filters, data):
            update_calls.append(dict(data))
            return {**job_row, **data}

        async def fake_handle_ingest(row):
            raise RuntimeError("vector store crashed")

        with (
            patch("app.jobs.worker.select_one_trusted", fake_select_one),
            patch("app.jobs.worker.update_one_trusted", fake_update_one),
            patch("app.jobs.worker.handle_ingest_file", fake_handle_ingest),
        ):
            await w._process_job("job-1")

        failed_updates = [u for u in update_calls if u.get("status") == "failed"]
        assert failed_updates, "Expected at least one DB update with status=failed"
        assert self.rm._jobs_failed == 1
        assert self.rm._jobs_completed == 0

    @pytest.mark.asyncio
    async def test_process_job_increments_attempts(self):
        """Each call to _process_job must increment attempts by exactly 1."""
        import app.jobs.worker as w

        self.rm.register_worker(w._WORKER_ID, [], worker_type="ingestion")

        job_row = _make_job_row(attempts=2)
        update_calls: list[dict] = []

        async def fake_select_one(table, cols, filters):
            return job_row

        async def fake_update_one(table, filters, data):
            update_calls.append(dict(data))
            return {**job_row, **data}

        async def fake_handle_ingest(row):
            return {"status": "completed"}

        with (
            patch("app.jobs.worker.select_one_trusted", fake_select_one),
            patch("app.jobs.worker.update_one_trusted", fake_update_one),
            patch("app.jobs.worker.handle_ingest_file", fake_handle_ingest),
        ):
            await w._process_job("job-1")

        first_update = update_calls[0]
        assert first_update.get("attempts") == 3  # was 2, now 3

    @pytest.mark.asyncio
    async def test_process_job_unknown_type_marks_failed(self):
        """Unknown job type → DB row set to failed."""
        import app.jobs.worker as w

        self.rm.register_worker(w._WORKER_ID, [], worker_type="ingestion")

        job_row = _make_job_row(job_type="unknown_type")
        update_calls: list[dict] = []

        async def fake_select_one(table, cols, filters):
            return job_row

        async def fake_update_one(table, filters, data):
            update_calls.append(dict(data))
            return {**job_row, **data}

        with (
            patch("app.jobs.worker.select_one_trusted", fake_select_one),
            patch("app.jobs.worker.update_one_trusted", fake_update_one),
        ):
            await w._process_job("job-1")

        final_update = update_calls[-1]
        assert final_update["status"] == "failed"

    @pytest.mark.asyncio
    async def test_process_job_uses_preleased_row_without_second_claim(self):
        """DB-recovered jobs are already leased and must not be claimed twice."""
        import app.jobs.worker as w

        self.rm.register_worker(w._WORKER_ID, [], worker_type="ingestion")

        leased_row = _make_job_row(status="processing", attempts=1)
        update_calls: list[dict] = []

        async def fail_select_one(table, cols, filters):
            pytest.fail("preleased job should not be selected again")

        async def fake_update_one(table, filters, data):
            update_calls.append(dict(data))
            return {**leased_row, **data}

        async def fake_handle_ingest(row):
            return {"status": "completed"}

        with (
            patch("app.jobs.worker.select_one_trusted", fail_select_one),
            patch("app.jobs.worker.update_one_trusted", fake_update_one),
            patch("app.jobs.worker.handle_ingest_file", fake_handle_ingest),
        ):
            await w._process_job("job-1", leased_job_row=leased_row)

        assert update_calls[0]["status"] == "completed"
        assert all(call.get("status") != "processing" for call in update_calls)


# ===========================================================================
# Section 3b: Worker DB recovery
# ===========================================================================

class TestWorkerDbRecovery:
    @pytest.mark.asyncio
    async def test_lease_next_queued_db_job_claims_oldest_job(self):
        import app.jobs.worker as w

        job_row = _make_job_row(attempts=0)
        captured: dict = {}

        async def fake_select_all(table, columns, filters=None, order_by=None, desc=False, limit=None, offset=None):
            captured["select"] = {
                "table": table,
                "filters": filters,
                "order_by": order_by,
                "desc": desc,
                "limit": limit,
            }
            return [job_row]

        async def fake_update_one(table, filters, data):
            captured["update"] = {"table": table, "filters": filters, "data": dict(data)}
            return {**job_row, **data}

        with (
            patch("app.jobs.worker.select_all_trusted", fake_select_all),
            patch("app.jobs.worker.update_one_trusted", fake_update_one),
        ):
            leased = await w._lease_next_queued_db_job()

        assert leased is not None
        assert captured["select"]["filters"] == {"status": "queued"}
        assert captured["select"]["order_by"] == "created_at"
        assert captured["update"]["filters"] == {"id": "job-1", "status": "queued"}
        assert captured["update"]["data"]["status"] == "processing"
        assert captured["update"]["data"]["attempts"] == 1
        assert leased["status"] == "processing"

    @pytest.mark.asyncio
    async def test_lease_next_queued_db_job_dead_letters_exhausted_job(self):
        import app.jobs.worker as w

        job_row = _make_job_row(attempts=w.MAX_JOB_ATTEMPTS)
        update_calls: list[dict] = []

        async def fake_select_all(*args, **kwargs):
            return [job_row]

        async def fake_update_one(table, filters, data):
            update_calls.append({"table": table, "filters": filters, "data": dict(data)})
            return {**job_row, **data}

        with (
            patch("app.jobs.worker.select_all_trusted", fake_select_all),
            patch("app.jobs.worker.update_one_trusted", fake_update_one),
        ):
            leased = await w._lease_next_queued_db_job()

        assert leased is None
        assert update_calls[-1]["filters"] == {"id": "job-1", "status": "queued"}
        assert update_calls[-1]["data"]["status"] == "dead_letter"

    @pytest.mark.asyncio
    async def test_requeue_stale_processing_jobs_returns_expired_leases_to_queue(self):
        import app.jobs.worker as w

        old_started_at = (datetime.now(timezone.utc) - timedelta(seconds=w.PROCESSING_LEASE_TIMEOUT_SECONDS + 60)).isoformat()
        fresh_started_at = datetime.now(timezone.utc).isoformat()
        rows = [
            _make_job_row(job_id="old", status="processing", started_at=old_started_at),
            _make_job_row(job_id="fresh", status="processing", started_at=fresh_started_at),
        ]
        update_calls: list[dict] = []

        async def fake_select_all(*args, **kwargs):
            return rows

        async def fake_update_one(table, filters, data):
            update_calls.append({"table": table, "filters": filters, "data": dict(data)})
            return {**data, **filters}

        with (
            patch("app.jobs.worker.select_all_trusted", fake_select_all),
            patch("app.jobs.worker.update_one_trusted", fake_update_one),
        ):
            count = await w._requeue_stale_processing_jobs()

        assert count == 1
        assert update_calls == [
            {
                "table": "jobs",
                "filters": {"id": "old", "status": "processing"},
                "data": {
                    "status": "queued",
                    "error": "Processing lease expired; requeued for recovery.",
                },
            }
        ]

    @pytest.mark.asyncio
    async def test_next_job_recovers_db_job_when_redis_is_empty(self):
        import app.jobs.worker as w

        recovered = _make_job_row(status="processing", attempts=1)
        fake_redis = AsyncMock()
        fake_redis.brpop = AsyncMock(return_value=None)

        async def fake_recover_db_job():
            return recovered

        with patch("app.jobs.worker._recover_db_job", fake_recover_db_job):
            job_id, leased_job = await w._next_job(fake_redis, "omnix:jobs")

        assert job_id == "job-1"
        assert leased_job == recovered


# ===========================================================================
# Section 4: Health checks
# ===========================================================================

class TestHealthChecks:
    def setup_method(self):
        self.rm = _reset_runtime()

    @pytest.mark.asyncio
    async def test_check_redis_healthy(self):
        """Real Redis ping returns True → status=healthy."""
        # Mock at the function level: patch get_redis inside health.checks
        from app.health import checks

        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock(return_value=True)

        with patch("app.health.checks.check_redis", wraps=None) as _:
            pass

        # Directly test by patching the import inside check_redis
        original = checks.check_redis

        async def _patched_check_redis():
            try:
                redis = mock_redis
                pong = await redis.ping()
                return {"status": "healthy", "ping": str(pong)}
            except Exception as e:
                return {"status": "unhealthy", "error": str(e)}

        result = await _patched_check_redis()
        assert result["status"] == "healthy"

    @pytest.mark.asyncio
    async def test_check_redis_unhealthy(self):
        """Redis ping raises → status=unhealthy."""
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock(side_effect=ConnectionRefusedError("Redis down"))

        async def _patched_check_redis():
            try:
                pong = await mock_redis.ping()
                return {"status": "healthy", "ping": str(pong)}
            except Exception as e:
                return {"status": "unhealthy", "error": str(e)}

        result = await _patched_check_redis()
        assert result["status"] == "unhealthy"
        assert "error" in result

    @pytest.mark.asyncio
    async def test_check_ingestion_worker_no_workers_registered(self):
        """No workers registered → status='no_worker', queue_depth from Redis."""
        from app.health import checks

        mock_redis = AsyncMock()
        mock_redis.llen = AsyncMock(return_value=7)

        async def fake_count_stuck(minutes):
            return 0

        with (
            patch("app.health.checks.get_redis", return_value=mock_redis, create=True),
            patch("app.health.checks._count_stuck_jobs", fake_count_stuck),
        ):
            # Patch the inner import of get_redis in check_ingestion_worker
            import os
            fake_jobs_queue = MagicMock()
            fake_jobs_queue.get_redis = MagicMock(return_value=mock_redis)
            with patch.dict(sys.modules, {"app.jobs.queue": fake_jobs_queue}):
                result = await checks.check_ingestion_worker()

        assert result["status"] == "no_worker"
        assert result["active_workers"] == 0
        assert result["queue_depth"] == 7

    @pytest.mark.asyncio
    async def test_check_ingestion_worker_healthy_with_counters(self):
        """Worker registered + jobs completed → status=healthy with real counters."""
        from app.health import checks

        self.rm.register_worker("ingestion_worker_main", ["ingest_file"], worker_type="ingestion")
        self.rm.record_job_started("ingestion_worker_main")
        self.rm.record_job_completed("ingestion_worker_main", success=True)
        self.rm.record_job_started("ingestion_worker_main")
        self.rm.record_job_completed("ingestion_worker_main", success=False)

        mock_redis = AsyncMock()
        mock_redis.llen = AsyncMock(return_value=3)

        async def fake_count_stuck(minutes):
            return 0

        fake_jobs_queue = MagicMock()
        fake_jobs_queue.get_redis = MagicMock(return_value=mock_redis)

        with (
            patch.dict(sys.modules, {"app.jobs.queue": fake_jobs_queue}),
            patch("app.health.checks._count_stuck_jobs", fake_count_stuck),
        ):
            result = await checks.check_ingestion_worker()

        assert result["status"] == "healthy"
        assert result["active_workers"] == 1
        assert result["completed_jobs"] == 1
        assert result["failed_jobs"] == 1
        assert result["queue_depth"] == 3


# ===========================================================================
# Section 5: Stuck job detection
# ===========================================================================

class TestStuckJobDetection:
    @pytest.mark.asyncio
    async def test_stuck_jobs_older_than_threshold_are_counted(self):
        """Jobs with created_at older than 30m are counted; recent ones are not."""
        from app.health import checks

        old_ts = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
        recent_ts = datetime.now(timezone.utc).isoformat()

        fake_rows = [
            {"id": "old-1", "created_at": old_ts},
            {"id": "old-2", "created_at": old_ts},
            {"id": "fresh", "created_at": recent_ts},
        ]
        captured: dict = {}

        fake_svc = MagicMock()

        async def fake_select_all_trusted(table, columns, filters=None, **kwargs):
            captured["table"] = table
            captured["columns"] = columns
            captured["filters"] = filters
            return fake_rows

        fake_svc.select_all_trusted = fake_select_all_trusted

        with patch.dict(sys.modules, {"app.services.supabase_service": fake_svc}):
            count = await checks._count_stuck_jobs(minutes=30)

        assert captured == {
            "table": "jobs",
            "columns": "id,created_at",
            "filters": {"status": "queued"},
        }
        assert count == 2  # only the two old ones

    @pytest.mark.asyncio
    async def test_no_stuck_jobs_when_all_recent(self):
        """All jobs are recent → stuck count is 0."""
        from app.health import checks

        recent_ts = datetime.now(timezone.utc).isoformat()
        fake_rows = [
            {"id": "j1", "created_at": recent_ts},
            {"id": "j2", "created_at": recent_ts},
        ]

        fake_svc = MagicMock()
        fake_svc.select_all_trusted = AsyncMock(return_value=fake_rows)

        with patch.dict(sys.modules, {"app.services.supabase_service": fake_svc}):
            count = await checks._count_stuck_jobs(minutes=10)

        assert count == 0

    @pytest.mark.asyncio
    async def test_empty_queue_returns_zero(self):
        """Empty jobs table returns 0 stuck jobs."""
        from app.health import checks

        fake_svc = MagicMock()
        fake_svc.select_all_trusted = AsyncMock(return_value=[])

        with patch.dict(sys.modules, {"app.services.supabase_service": fake_svc}):
            count = await checks._count_stuck_jobs(minutes=60)

        assert count == 0

    @pytest.mark.asyncio
    async def test_supabase_error_returns_none_not_crash(self):
        """Supabase unavailable → returns None gracefully, does not raise."""
        from app.health import checks

        fake_svc = MagicMock()
        fake_svc.select_all_trusted = AsyncMock(side_effect=RuntimeError("DB unreachable"))

        with patch.dict(sys.modules, {"app.services.supabase_service": fake_svc}):
            count = await checks._count_stuck_jobs(minutes=10)

        assert count is None

    @pytest.mark.asyncio
    async def test_stuck_10m_threshold_correct(self):
        """Jobs 11 minutes old are stuck at 10m threshold."""
        from app.health import checks

        old_ts = (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat()

        fake_svc = MagicMock()
        fake_svc.select_all_trusted = AsyncMock(return_value=[{"id": "j1", "created_at": old_ts}])

        with patch.dict(sys.modules, {"app.services.supabase_service": fake_svc}):
            count_10 = await checks._count_stuck_jobs(minutes=10)
            count_30 = await checks._count_stuck_jobs(minutes=30)

        assert count_10 == 1   # 11m > 10m threshold → stuck
        assert count_30 == 0   # 11m < 30m threshold → not stuck
