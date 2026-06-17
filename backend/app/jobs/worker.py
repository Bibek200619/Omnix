from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from .queue import get_redis
from .ingestion_jobs import handle_ingest_file
from .automation_jobs import handle_run_automation
from ..services.supabase_service import select_all_trusted, select_one_trusted, update_one_trusted
from ..rag.startup import initialize_vector_store, shutdown_vector_store
from ..embeddings.provider import warm_up_default_provider
from ..runtime.manager import RuntimeManager

logger = logging.getLogger(__name__)

_WORKER_ID = f"ingestion_worker_{uuid.uuid4().hex[:8]}"
WORKER_LAST_FAILURE_KEY = "omnix:worker:last_failure"
MAX_JOB_ATTEMPTS = int(os.environ.get("OMNIX_JOB_MAX_ATTEMPTS", "3"))
DB_RECOVERY_BATCH_SIZE = int(os.environ.get("OMNIX_DB_JOB_RECOVERY_BATCH_SIZE", "25"))
PROCESSING_LEASE_TIMEOUT_SECONDS = int(os.environ.get("OMNIX_JOB_LEASE_TIMEOUT_SECONDS", "900"))


def _worker_concurrency() -> int:
    raw = os.environ.get("OMNIX_WORKER_CONCURRENCY", "1")
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        logger.warning("Invalid OMNIX_WORKER_CONCURRENCY=%r; using 1.", raw)
        return 1


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _record_worker_startup_failure(runtime: RuntimeManager, stage: str, exc: Exception) -> None:
    reason = f"{stage}: {exc}"
    runtime.set_status("failed", reason=reason)
    payload = {
        "worker_id": _WORKER_ID,
        "stage": stage,
        "reason": str(exc),
        "failed_at": _utc_now_iso(),
    }
    try:
        await get_redis().set(WORKER_LAST_FAILURE_KEY, json.dumps(payload))
    except Exception:
        logger.exception("Failed to write worker startup failure to Redis.")


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _coerce_attempts(job_row: dict[str, Any]) -> int:
    try:
        return int(job_row.get("attempts") or 0)
    except (TypeError, ValueError):
        return 0


async def _dead_letter_job(
    job_row: dict[str, Any],
    reason: str,
    *,
    expected_status: str | None = None,
) -> dict[str, Any] | None:
    job_id = str(job_row.get("id") or "")
    if not job_id:
        return None
    filters = {"id": job_id}
    if expected_status:
        filters["status"] = expected_status
    logger.error("Dead-lettering job %s: %s", job_id, reason)
    return await update_one_trusted(
        "jobs",
        filters,
        {
            "status": "dead_letter",
            "error": reason,
            "completed_at": _utc_now_iso(),
        },
    )


async def _lease_queued_job(job_row: dict[str, Any]) -> dict[str, Any] | None:
    """Claim a queued job via a conditional status update.

    Multiple worker processes can safely race here: only the worker whose
    update sees status='queued' receives the leased row.
    """
    job_id = str(job_row.get("id") or "")
    if not job_id:
        return None

    attempts = _coerce_attempts(job_row)
    if attempts >= MAX_JOB_ATTEMPTS:
        await _dead_letter_job(
            job_row,
            f"Job exceeded max attempts ({MAX_JOB_ATTEMPTS}).",
            expected_status="queued",
        )
        return None

    return await update_one_trusted(
        "jobs",
        {"id": job_id, "status": "queued"},
        {
            "status": "processing",
            "attempts": attempts + 1,
            "started_at": _utc_now_iso(),
            "error": None,
        },
    )


async def _load_and_lease_job(job_id: str) -> dict[str, Any] | None:
    job_row = await select_one_trusted("jobs", "*", {"id": job_id})
    if not job_row:
        logger.warning("Job %s missing in DB; skipping", job_id)
        return None

    status = str(job_row.get("status") or "")
    if status != "queued":
        logger.info("Job %s has status %s; skipping duplicate queue delivery", job_id, status)
        return None

    leased = await _lease_queued_job(job_row)
    if leased is None:
        logger.info("Job %s was not leased; another worker may have claimed it.", job_id)
    return leased


async def _requeue_stale_processing_jobs() -> int:
    threshold = datetime.now(timezone.utc) - timedelta(seconds=PROCESSING_LEASE_TIMEOUT_SECONDS)
    rows = await select_all_trusted(
        "jobs",
        "*",
        filters={"status": "processing"},
        order_by="started_at",
        desc=False,
        limit=DB_RECOVERY_BATCH_SIZE,
    )
    requeued = 0
    for row in rows:
        started_at = _parse_timestamp(row.get("started_at")) or _parse_timestamp(row.get("created_at"))
        if started_at is None or started_at > threshold:
            continue

        if _coerce_attempts(row) >= MAX_JOB_ATTEMPTS:
            await _dead_letter_job(
                row,
                f"Processing lease expired after max attempts ({MAX_JOB_ATTEMPTS}).",
                expected_status="processing",
            )
            continue

        updated = await update_one_trusted(
            "jobs",
            {"id": row.get("id"), "status": "processing"},
            {
                "status": "queued",
                "error": "Processing lease expired; requeued for recovery.",
            },
        )
        if updated:
            requeued += 1
    if requeued:
        logger.warning("Requeued %d stale processing ingestion jobs.", requeued)
    return requeued


async def _lease_next_queued_db_job() -> dict[str, Any] | None:
    rows = await select_all_trusted(
        "jobs",
        "*",
        filters={"status": "queued"},
        order_by="created_at",
        desc=False,
        limit=DB_RECOVERY_BATCH_SIZE,
    )
    for row in rows:
        leased = await _lease_queued_job(row)
        if leased:
            logger.info("Recovered queued DB job %s without Redis delivery.", leased.get("id"))
            return leased
    return None


async def _recover_db_job() -> dict[str, Any] | None:
    await _requeue_stale_processing_jobs()
    return await _lease_next_queued_db_job()


async def _next_job(redis: Any, queue_name: str) -> tuple[str | None, dict[str, Any] | None]:
    item = await redis.brpop(queue_name, timeout=5)
    if item:
        _, job_id = item
        return str(job_id), None

    recovered = await _recover_db_job()
    if recovered:
        return str(recovered.get("id")), recovered
    return None, None


async def _process_job(job_id: str, leased_job_row: dict[str, Any] | None = None):
    """Fetch job row, mark processing, run handler, update result."""
    runtime = RuntimeManager.get()
    runtime.record_job_started(_WORKER_ID)
    success = False
    try:
        job_row = leased_job_row or await _load_and_lease_job(job_id)
        if not job_row:
            return

        job_type = job_row.get("type")
        if job_type == "ingest_file":
            result = await handle_ingest_file(job_row)
        elif job_type == "run_automation":
            result = await handle_run_automation(job_row)
        elif job_type == "reembed_batch":
            from .reembed_jobs import handle_reembed_batch

            result = await handle_reembed_batch(job_row)
        else:
            logger.error("Unknown job type %s for job %s", job_type, job_id)
            result = {"status": "failed", "error": "unknown job type"}

        status = result.get("status", "failed")
        await update_one_trusted(
            "jobs",
            {"id": job_id},
            {
                "status": status,
                "progress": 100,
                "result": result,
                "completed_at": _utc_now_iso(),
            },
        )
        success = status == "completed"
        logger.info("Job %s finished with status %s", job_id, status)
    except Exception as exc:
        logger.exception("Processing job %s failed: %s", job_id, exc)
        try:
            await update_one_trusted(
                "jobs",
                {"id": job_id},
                {"status": "failed", "error": str(exc), "completed_at": _utc_now_iso()},
            )
        except Exception:
            logger.exception("Failed to update job row for job %s after exception", job_id)
    finally:
        runtime.record_job_completed(_WORKER_ID, success=success)


async def _observe_finished_tasks(job_tasks: set[asyncio.Task[Any]]) -> set[asyncio.Task[Any]]:
    pending: set[asyncio.Task[Any]] = set()
    for task in job_tasks:
        if not task.done():
            pending.add(task)
            continue
        try:
            await task
        except asyncio.CancelledError:
            logger.warning("Worker job task was cancelled.")
        except Exception:
            logger.exception("Worker job task crashed outside job handler.")
    return pending


async def _worker_loop(shutdown_event: asyncio.Event):
    """Main worker lifecycle: initialize infra, then poll Redis and process jobs."""
    runtime = RuntimeManager.get()

    # Initialize retrieval/vector store
    try:
        logger.info("Worker startup: initializing vector store...")
        await initialize_vector_store()
        logger.info("Vector store initialized in worker.")
    except Exception as exc:
        logger.exception("Worker startup failed to initialize vector store: %s", exc)
        await _record_worker_startup_failure(runtime, "vector_store_init", exc)
        raise SystemExit(1) from exc

    # Initialize embeddings provider early to validate local dependencies/model cache.
    try:
        provider = await warm_up_default_provider()
        logger.info("Embedding provider initialized in worker: %s", provider.__class__.__name__)
    except Exception as exc:
        logger.exception("Worker startup failed to initialize embeddings provider: %s", exc)
        return

    # Connect to Redis
    try:
        redis = get_redis()
        queue_name = os.environ.get("OMNIX_JOB_QUEUE", "omnix:jobs")
        logger.info("Worker ready; listening on queue %s", queue_name)
    except Exception as exc:
        logger.exception("Failed to connect to Redis during worker startup: %s", exc)
        return

    # Register with RuntimeManager
    runtime.register_worker(_WORKER_ID, capabilities=["ingest_file", "reembed_batch"], worker_type="ingestion")
    runtime.set_status("running")
    concurrency = _worker_concurrency()
    job_tasks: set[asyncio.Task[Any]] = set()
    logger.info("Worker %s running with concurrency=%d.", _WORKER_ID, concurrency)

    # Poll loop
    while not shutdown_event.is_set():
        try:
            job_tasks = await _observe_finished_tasks(job_tasks)
            if len(job_tasks) >= concurrency:
                done, pending = await asyncio.wait(
                    job_tasks,
                    timeout=0.1,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                observed_done = await _observe_finished_tasks(set(done))
                job_tasks = observed_done | set(pending)
                continue

            job_id, leased_job_row = await _next_job(redis, queue_name)
            if not job_id:
                await asyncio.sleep(0.1)
                continue
            logger.info("Dequeued job %s", job_id)
            job_tasks.add(
                asyncio.create_task(
                    _process_job(job_id, leased_job_row=leased_job_row),
                    name=f"omnix-job-{job_id}",
                )
            )
        except Exception as exc:
            logger.exception("Worker loop error: %s", exc)
            await asyncio.sleep(1)

    logger.info("Shutdown event set; cleaning up worker...")
    if job_tasks:
        logger.info("Waiting for %d in-flight worker job(s) to finish.", len(job_tasks))
        results = await asyncio.gather(*job_tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                logger.error(
                    "In-flight worker job crashed during shutdown.",
                    exc_info=(type(result), result, result.__traceback__),
                )
    try:
        await shutdown_vector_store()
        logger.info("Vector store shutdown completed in worker.")
    except Exception:
        logger.exception("Error shutting down vector store in worker.")


def run_worker():
    """Entrypoint for running worker in a standalone process.

    Uses asyncio.run for startup/shutdown lifecycle compatible with Python 3.14+.
    """
    logging.basicConfig(level=logging.INFO)
    shutdown_event = asyncio.Event()

    # Signal handler to set shutdown_event
    import signal

    def _handler(sig_num, frame):
        logger.info("Worker received signal %s, initiating shutdown.", sig_num)
        shutdown_event.set()

    signal.signal(signal.SIGINT, _handler)
    signal.signal(signal.SIGTERM, _handler)

    try:
        asyncio.run(_worker_loop(shutdown_event))
    except Exception:
        logger.exception("Worker runtime crashed.")


if __name__ == "__main__":
    run_worker()
