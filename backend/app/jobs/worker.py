from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from .queue import (
    get_redis,
    push_job_id,
    queue_name_for_payload,
    queued_job_ids_for_queue,
    recover_missing_queued_jobs,
    worker_queue_name,
)
from .ingestion_jobs import handle_ingest_file
from .automation_jobs import handle_run_automation
from .file_lifecycle_jobs import (
    handle_cleanup_file_storage,
    handle_expire_file,
    lifecycle_maintenance_interval_seconds,
    run_file_lifecycle_maintenance_once,
)
from ..services.supabase_service import update_one_trusted, select_one_trusted
from ..rag.startup import initialize_vector_store, shutdown_vector_store
from ..embeddings.provider import warm_up_default_provider
from ..runtime.manager import RuntimeManager

logger = logging.getLogger(__name__)

_WORKER_ID = "ingestion_worker_main"
_DEFAULT_WORKER_CONCURRENCY = 4
_DEFAULT_JOB_TIMEOUT_SECONDS = 15 * 60
_DEFAULT_POLL_TIMEOUT_SECONDS = 5.0
_DEFAULT_REDIS_OPERATION_TIMEOUT_SECONDS = 7.0
_DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 30.0
_DEFAULT_MAX_JOB_ATTEMPTS = 3
_DEFAULT_QUEUE_RECOVERY_INTERVAL_SECONDS = 60.0
_DEFAULT_DATABASE_QUEUE_FALLBACK_INTERVAL_SECONDS = 5.0
_DEFAULT_OCR_WORKER_CONCURRENCY = 1
_DEFAULT_OCR_JOB_TIMEOUT_SECONDS = 30 * 60
_FILE_LIFECYCLE_JOB_TYPES = ("cleanup_file_storage", "expire_file")


@dataclass
class _JobClaim:
    row: dict[str, Any] | None = None
    attempt_number: int = 0


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("Invalid integer for %s=%r; using %d.", name, raw, default)
        return default
    return max(minimum, value)


def _env_float(name: str, default: float, *, minimum: float = 0.1) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("Invalid float for %s=%r; using %.2f.", name, raw, default)
        return default
    return max(minimum, value)


def _decode_job_id(raw_job_id: Any) -> str:
    if isinstance(raw_job_id, bytes):
        return raw_job_id.decode("utf-8")
    return str(raw_job_id)


def _max_job_attempts() -> int:
    return _env_int("OMNIX_JOB_MAX_ATTEMPTS", _DEFAULT_MAX_JOB_ATTEMPTS)


def _is_ocr_worker() -> bool:
    return os.environ.get("OMNIX_ROLE") == "ocr_worker"


def _worker_id() -> str:
    return os.environ.get("OMNIX_WORKER_ID", _WORKER_ID)


def _worker_concurrency() -> int:
    if _is_ocr_worker():
        return _env_int("OMNIX_OCR_WORKER_CONCURRENCY", _DEFAULT_OCR_WORKER_CONCURRENCY)
    return _env_int("OMNIX_WORKER_CONCURRENCY", _DEFAULT_WORKER_CONCURRENCY)


def _job_timeout_seconds() -> float:
    if _is_ocr_worker():
        return _env_float("OMNIX_OCR_JOB_TIMEOUT_SECONDS", _DEFAULT_OCR_JOB_TIMEOUT_SECONDS)
    return _env_float("OMNIX_JOB_TIMEOUT_SECONDS", _DEFAULT_JOB_TIMEOUT_SECONDS)


async def _push_retry_job(job_id: str, *, queue_name: str | None = None) -> None:
    await push_job_id(job_id, queue=queue_name or worker_queue_name())


async def _recover_missing_queued_jobs_once(queue_name: str) -> dict[str, Any] | None:
    try:
        result = await recover_missing_queued_jobs(queue=queue_name)
    except Exception as exc:
        logger.warning("Queued job recovery scan failed for %s: %s", queue_name, exc)
        return None

    if result.get("requeued_jobs"):
        logger.warning(
            "Recovered %s queued job(s) missing from Redis queue %s.",
            result["requeued_jobs"],
            queue_name,
        )
    if result.get("failed_requeue_jobs"):
        logger.error(
            "Queue recovery failed to requeue %s job(s) for %s.",
            result["failed_requeue_jobs"],
            queue_name,
        )
    return result


async def _database_fallback_job_ids_once(queue_name: str, *, limit: int) -> list[str]:
    try:
        job_ids = await queued_job_ids_for_queue(queue=queue_name, limit=limit)
    except Exception as exc:
        logger.warning("Durable queue fallback scan failed for %s: %s", queue_name, exc)
        return []

    if job_ids:
        logger.warning(
            "Scheduling %d durable queued job(s) for %s without a Redis wake-up.",
            len(job_ids),
            queue_name,
        )
    return job_ids


async def _run_file_lifecycle_maintenance_once() -> dict[str, int] | None:
    try:
        result = await run_file_lifecycle_maintenance_once()
    except Exception as exc:
        logger.warning("File lifecycle maintenance scan failed: %s", exc)
        return None

    if result["expired_jobs"] or result["orphan_jobs"]:
        logger.info(
            "File lifecycle maintenance queued expired=%d orphan=%d after scanning=%d.",
            result["expired_jobs"],
            result["orphan_jobs"],
            result["objects_scanned"],
        )
    return result


async def _retry_or_dead_letter_job(
    job_id: str,
    job_row: dict[str, Any],
    *,
    attempt_number: int,
    result: dict[str, Any],
    error: str,
    require_owned_claim: bool = False,
) -> str:
    max_attempts = _max_job_attempts()
    filters: dict[str, Any] = {"id": job_id}
    if require_owned_claim:
        filters.update(status="processing", attempts=attempt_number)
    if attempt_number < max_attempts:
        retry_payload = {
            "status": "queued",
            "progress": 0,
            "error": error,
            "result": {
                **result,
                "retryable": True,
                "attempt": attempt_number,
                "max_attempts": max_attempts,
            },
        }
        updated_row = await update_one_trusted("jobs", filters, retry_payload)
        if require_owned_claim and updated_row is None:
            logger.warning(
                "Interrupted job %s no longer matches its owned claim.", job_id
            )
            return "claim_lost"
        try:
            await _push_retry_job(job_id, queue_name=queue_name_for_payload(job_row.get("payload")))
        except Exception:
            logger.exception(
                "Failed to push retry for job %s to Redis; DB row remains queued for recovery.",
                job_id,
            )
        logger.warning(
            "Job %s failed on attempt %d/%d and was requeued.",
            job_id,
            attempt_number,
            max_attempts,
        )
        return "queued"

    dead_letter_payload = {
        "status": "dead_lettered",
        "progress": 100,
        "error": error,
        "result": {
            **result,
            "retryable": False,
            "attempt": attempt_number,
            "max_attempts": max_attempts,
        },
    }
    updated_row = await update_one_trusted("jobs", filters, dead_letter_payload)
    if require_owned_claim and updated_row is None:
        logger.warning("Interrupted job %s no longer matches its owned claim.", job_id)
        return "claim_lost"
    logger.error("Job %s moved to dead_lettered after %d attempt(s): %s", job_id, attempt_number, error)
    return "dead_lettered"


async def _process_job(job_id: str, *, claim_state: _JobClaim | None = None):
    """Claim a queued job, run its handler once, and persist its result."""
    runtime = RuntimeManager.get()
    success = False
    runtime_recorded = False
    try:
        job_row = await select_one_trusted("jobs", "*", {"id": job_id})
        if not job_row:
            logger.warning("Job %s missing in DB; skipping", job_id)
            # A stale Redis entry is still an operational failure, unlike a
            # duplicate delivery that loses the conditional claim below.
            runtime.record_job_started(_worker_id())
            runtime_recorded = True
            return

        # Atomically claim the row. Redis retries, recovery, and database
        # fallback can all deliver the same id; only the first worker may run it.
        attempt_number = int(job_row.get("attempts") or 0) + 1
        claimed_row = await update_one_trusted(
            "jobs",
            {"id": job_id, "status": "queued"},
            {"status": "processing", "attempts": attempt_number},
        )
        if claimed_row is None:
            logger.info("Job %s was already claimed by another worker; skipping duplicate delivery.", job_id)
            return

        job_row = {**job_row, **claimed_row}
        if claim_state is not None:
            claim_state.row = job_row
            claim_state.attempt_number = attempt_number
        runtime.record_job_started(_worker_id())
        runtime_recorded = True

        job_type = job_row.get("type")
        if job_type == "ingest_file":
            result = await handle_ingest_file(job_row)
        elif job_type == "run_automation":
            result = await handle_run_automation(job_row)
        elif job_type == "reembed_batch":
            from .reembed_jobs import handle_reembed_batch

            result = await handle_reembed_batch(job_row)
        elif job_type == "cleanup_file_storage":
            result = await handle_cleanup_file_storage(job_row)
        elif job_type == "expire_file":
            result = await handle_expire_file(job_row)
        else:
            logger.error("Unknown job type %s for job %s", job_type, job_id)
            result = {"status": "failed", "error": "unknown job type"}

        status = result.get("status", "failed")
        if status == "failed" and job_type in {
            "ingest_file",
            "run_automation",
            "reembed_batch",
            *_FILE_LIFECYCLE_JOB_TYPES,
        }:
            status = await _retry_or_dead_letter_job(
                job_id,
                job_row,
                attempt_number=attempt_number,
                result=result,
                error=str(result.get("error") or "Job failed"),
            )
        else:
            await update_one_trusted(
                "jobs",
                {"id": job_id},
                {"status": status, "progress": 100, "result": result},
            )
        success = status == "completed"
        logger.info("Job %s finished with status %s", job_id, status)
    except Exception as exc:
        logger.exception("Processing job %s failed: %s", job_id, exc)
        try:
            retry_row = job_row if "job_row" in locals() and isinstance(job_row, dict) else {"attempts": 0}
            retry_attempt = int(retry_row.get("attempts") or 0) + 1
            if "attempt_number" in locals():
                retry_attempt = int(attempt_number)
            await _retry_or_dead_letter_job(
                job_id,
                retry_row,
                attempt_number=retry_attempt,
                result={"status": "failed", "error": str(exc)},
                error=str(exc),
            )
        except Exception:
            logger.exception("Failed to update job row for job %s after exception", job_id)
    finally:
        if runtime_recorded:
            runtime.record_job_completed(_worker_id(), success=success)


async def _process_job_with_timeout(job_id: str, *, timeout_seconds: float) -> None:
    claim = _JobClaim()

    async def recover_claim(error: str) -> None:
        if claim.row is None:
            return
        try:
            await _retry_or_dead_letter_job(
                job_id,
                claim.row,
                attempt_number=claim.attempt_number,
                result={"status": "failed", "error": error},
                error=error,
                require_owned_claim=True,
            )
        except Exception:
            logger.error(
                "Failed to recover interrupted job %s; claim remains unresolved.",
                job_id,
            )

    try:
        await asyncio.wait_for(
            _process_job(job_id, claim_state=claim), timeout=timeout_seconds
        )
    except asyncio.TimeoutError:
        error = f"Job exceeded timeout of {timeout_seconds:g}s"
        logger.error("Processing job %s timed out: %s", job_id, error)
        await recover_claim(error)
    except asyncio.CancelledError:
        # wait_for has awaited handler cancellation before releasing its claim.
        await recover_claim("Job interrupted during worker shutdown")
        raise


async def _run_limited_job(job_id: str, semaphore: asyncio.Semaphore, *, timeout_seconds: float) -> None:
    async with semaphore:
        await _process_job_with_timeout(job_id, timeout_seconds=timeout_seconds)


def _consume_finished_tasks(tasks: set[asyncio.Task[None]], finished: Iterable[asyncio.Task[None]] | None = None) -> None:
    done = set(finished) if finished is not None else {task for task in tasks if task.done()}
    if not done:
        return
    tasks.difference_update(done)
    for task in done:
        try:
            task.result()
        except asyncio.CancelledError:
            logger.info("Worker job task was cancelled during shutdown.")
        except Exception as exc:
            logger.exception("Worker job task crashed: %s", exc)


async def _drain_in_flight_jobs(tasks: set[asyncio.Task[None]], *, timeout_seconds: float) -> None:
    if not tasks:
        return
    logger.info("Waiting for %d in-flight job(s) to finish before shutdown.", len(tasks))
    done, pending = await asyncio.wait(tasks, timeout=timeout_seconds)
    _consume_finished_tasks(tasks, done)
    if not pending:
        return

    logger.warning("Cancelling %d in-flight job(s) after %.2fs shutdown timeout.", len(pending), timeout_seconds)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    _consume_finished_tasks(tasks, pending)


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
        return

    # Initialize embeddings provider early to validate local dependencies/model cache.
    try:
        provider = await warm_up_default_provider()
        logger.info("Embedding provider initialized in worker: %s", provider.__class__.__name__)
    except Exception as exc:
        logger.exception("Worker startup failed to initialize embeddings provider: %s", exc)
        return

    # Construct the bounded Redis client. A connection outage is handled by the
    # durable queue fallback in the polling loop below.
    try:
        redis = get_redis()
        queue_name = worker_queue_name()
        concurrency = _worker_concurrency()
        job_timeout_seconds = _job_timeout_seconds()
        poll_timeout_seconds = _env_float("OMNIX_WORKER_POLL_TIMEOUT_SECONDS", _DEFAULT_POLL_TIMEOUT_SECONDS)
        redis_operation_timeout_seconds = max(
            poll_timeout_seconds + 1.0,
            _env_float("OMNIX_REDIS_OPERATION_TIMEOUT_SECONDS", _DEFAULT_REDIS_OPERATION_TIMEOUT_SECONDS),
        )
        recovery_interval_seconds = _env_float(
            "OMNIX_QUEUE_RECOVERY_INTERVAL_SECONDS",
            _DEFAULT_QUEUE_RECOVERY_INTERVAL_SECONDS,
        )
        database_fallback_interval_seconds = _env_float(
            "OMNIX_DATABASE_QUEUE_FALLBACK_INTERVAL_SECONDS",
            _DEFAULT_DATABASE_QUEUE_FALLBACK_INTERVAL_SECONDS,
        )
        shutdown_timeout_seconds = _env_float(
            "OMNIX_WORKER_SHUTDOWN_TIMEOUT_SECONDS",
            _DEFAULT_SHUTDOWN_TIMEOUT_SECONDS,
        )
        logger.info(
            "Worker ready; listening on queue %s with concurrency=%d job_timeout=%.2fs durable_fallback=%.2fs",
            queue_name,
            concurrency,
            job_timeout_seconds,
            database_fallback_interval_seconds,
        )
    except Exception as exc:
        logger.exception("Failed to configure Redis client during worker startup: %s", exc)
        return

    # Register with RuntimeManager
    capabilities = [
        "ingest_file",
        "run_automation",
        "reembed_batch",
        *_FILE_LIFECYCLE_JOB_TYPES,
    ]
    if _is_ocr_worker():
        capabilities.append("ocr")
    runtime.register_worker(_worker_id(), capabilities=capabilities, worker_type="ingestion")
    runtime.set_status("running")

    semaphore = asyncio.Semaphore(concurrency)
    in_flight: set[asyncio.Task[None]] = set()
    last_recovery_scan = 0.0
    last_database_fallback_scan = asyncio.get_running_loop().time()
    lifecycle_maintenance_interval = lifecycle_maintenance_interval_seconds()
    last_lifecycle_maintenance = (
        asyncio.get_running_loop().time() - lifecycle_maintenance_interval
    )
    redis_unavailable = False
    force_database_fallback = False

    def _schedule_job(job_id: str) -> None:
        task = asyncio.create_task(
            _run_limited_job(job_id, semaphore, timeout_seconds=job_timeout_seconds),
            name=f"omnix-job-{job_id}",
        )
        in_flight.add(task)

    try:
        # Poll loop
        while not shutdown_event.is_set():
            _consume_finished_tasks(in_flight)

            if len(in_flight) >= concurrency:
                done, _ = await asyncio.wait(in_flight, timeout=0.25, return_when=asyncio.FIRST_COMPLETED)
                _consume_finished_tasks(in_flight, done)
                continue

            now = asyncio.get_running_loop().time()
            if (
                not _is_ocr_worker()
                and now - last_lifecycle_maintenance >= lifecycle_maintenance_interval
            ):
                last_lifecycle_maintenance = now
                await _run_file_lifecycle_maintenance_once()

            if force_database_fallback or now - last_database_fallback_scan >= database_fallback_interval_seconds:
                last_database_fallback_scan = now
                force_database_fallback = False
                available_slots = concurrency - len(in_flight)
                fallback_job_ids = await _database_fallback_job_ids_once(queue_name, limit=available_slots)
                if fallback_job_ids:
                    for fallback_job_id in fallback_job_ids[:available_slots]:
                        _schedule_job(fallback_job_id)
                    continue

            try:
                item = await asyncio.wait_for(
                    redis.brpop(queue_name, timeout=int(poll_timeout_seconds)),
                    timeout=redis_operation_timeout_seconds,
                )
                redis_unavailable = False
                if not item:
                    now = asyncio.get_running_loop().time()
                    if now - last_recovery_scan >= recovery_interval_seconds:
                        last_recovery_scan = now
                        await _recover_missing_queued_jobs_once(queue_name)
                    await asyncio.sleep(0.1)
                    continue
                _, raw_job_id = item
                job_id = _decode_job_id(raw_job_id)
                logger.info("Dequeued job %s", job_id)
                _schedule_job(job_id)
            except asyncio.TimeoutError:
                logger.warning(
                    "Redis poll for queue %s exceeded %.2fs operation timeout.",
                    queue_name,
                    redis_operation_timeout_seconds,
                )
                if not redis_unavailable:
                    force_database_fallback = True
                redis_unavailable = True
                await asyncio.sleep(0.1)
            except Exception as exc:
                logger.exception("Worker loop error: %s", exc)
                if not redis_unavailable:
                    force_database_fallback = True
                redis_unavailable = True
                await asyncio.sleep(0.1)
    finally:
        await _drain_in_flight_jobs(in_flight, timeout_seconds=shutdown_timeout_seconds)

    logger.info("Shutdown event set; cleaning up worker...")
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
