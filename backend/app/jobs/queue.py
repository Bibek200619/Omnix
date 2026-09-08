from __future__ import annotations

import asyncio
import os
import uuid
import logging
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from ..bootstrap import redis as redis_bootstrap

logger = logging.getLogger(__name__)

DEFAULT_REDIS_URL = "redis://localhost:6379/0"
REDIS_URL = os.environ.get("REDIS_URL", DEFAULT_REDIS_URL)
_DEFAULT_QUEUE_KEY = "omnix:jobs"
_DEFAULT_OCR_QUEUE_KEY = "omnix:ocr"
_QUEUE_KEY = os.environ.get("OMNIX_JOB_QUEUE", _DEFAULT_QUEUE_KEY)
_QUEUE_PAYLOAD_KEY = "_queue"
_DEFAULT_QUEUE_RECOVERY_MIN_AGE_SECONDS = 60.0
_DEFAULT_QUEUE_RECOVERY_LIMIT = 100
_DEFAULT_REDIS_OPERATION_TIMEOUT_SECONDS = 5.0
_DEFAULT_DATABASE_FALLBACK_LIMIT = 16

_LPUSH_IF_ABSENT_SCRIPT = """
local existing = redis.call('LRANGE', KEYS[1], 0, -1)
for _, value in ipairs(existing) do
  if value == ARGV[1] then
    return 0
  end
end
redis.call('LPUSH', KEYS[1], ARGV[1])
return 1
"""

# Compatibility alias for callers that previously patched this module. The
# object itself is always created by bootstrap.redis, so every entry point uses
# the same connection policy.
_redis_client: Any | None = None


class JobEnqueueError(RuntimeError):
    def __init__(self, message: str, *, job_id: str, persisted: bool) -> None:
        super().__init__(message)
        self.job_id = job_id
        self.persisted = persisted


def get_redis() -> Any:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_bootstrap.get_redis()
    return _redis_client


def primary_job_queue() -> str:
    """Return the queue reserved for ordinary ingestion work.

    OCR workers deliberately use a different active queue, so their process-local
    ``OMNIX_JOB_QUEUE`` must not become the fallback for legacy jobs with no
    persisted routing marker.
    """
    configured = os.environ.get("OMNIX_INGESTION_QUEUE")
    if configured:
        return configured
    if os.environ.get("OMNIX_ROLE") == "ocr_worker":
        return _DEFAULT_QUEUE_KEY
    return os.environ.get("OMNIX_JOB_QUEUE", _QUEUE_KEY)


def ocr_job_queue() -> str:
    return os.environ.get("OMNIX_OCR_JOB_QUEUE", _DEFAULT_OCR_QUEUE_KEY)


def worker_queue_name() -> str:
    """Resolve the active queue from an explicit worker role."""
    if os.environ.get("OMNIX_ROLE") == "ocr_worker":
        return ocr_job_queue()
    if os.environ.get("OMNIX_ROLE") == "ingestion_worker":
        return primary_job_queue()
    return os.environ.get("OMNIX_JOB_QUEUE", primary_job_queue())


def ingestion_queue_for_file(filename: str | None, file_type: str | None) -> str:
    """Route PDFs to the bounded OCR worker before costly extraction begins."""
    name = (filename or "").lower()
    content_type = (file_type or "").lower()
    if name.endswith(".pdf") or "pdf" in content_type:
        return ocr_job_queue()
    return primary_job_queue()


def _payload_mapping(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            decoded = json.loads(payload)
        except (TypeError, ValueError):
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def queue_name_for_payload(payload: Any) -> str:
    """Resolve a persisted queue marker, safely defaulting legacy jobs to normal ingestion."""
    queue_name = _payload_mapping(payload).get(_QUEUE_PAYLOAD_KEY)
    if isinstance(queue_name, str) and queue_name.strip():
        return queue_name
    return primary_job_queue()


def _queue_name(queue: str | None = None) -> str:
    return queue or worker_queue_name()


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("Invalid float for %s=%r; using %.2f.", name, raw, default)
        return default
    return max(minimum, value)


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


def _redis_operation_timeout_seconds() -> float:
    return _env_float(
        "OMNIX_REDIS_OPERATION_TIMEOUT_SECONDS",
        _DEFAULT_REDIS_OPERATION_TIMEOUT_SECONDS,
        minimum=0.1,
    )


async def _await_redis_operation(operation: Any) -> Any:
    """Bound an individual Redis command even when a client is lazily connected."""
    return await asyncio.wait_for(operation, timeout=_redis_operation_timeout_seconds())


def _decode_redis_value(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


async def _lpush_if_absent(redis: Any, queue_name: str, job_id: str, queued_ids: set[str]) -> bool:
    if job_id in queued_ids:
        return False

    eval_script = getattr(redis, "eval", None)
    if callable(eval_script):
        pushed = await _await_redis_operation(eval_script(_LPUSH_IF_ABSENT_SCRIPT, 1, queue_name, job_id))
        queued_ids.add(job_id)
        return bool(int(pushed))

    await _await_redis_operation(redis.lpush(queue_name, job_id))
    queued_ids.add(job_id)
    return True


async def push_job_id(job_id: str, *, queue: str | None = None) -> None:
    """Push a persisted job id to Redis with a bounded command deadline."""
    redis = get_redis()
    await _await_redis_operation(redis.lpush(_queue_name(queue), job_id))


async def queued_job_ids_for_queue(
    *,
    queue: str | None = None,
    limit: int | None = None,
) -> list[str]:
    """Return the oldest durable queued job ids for one worker queue.

    Redis is a wake-up path, not the source of truth. The queue marker is queried
    in Postgres so an OCR backlog cannot consume the ordinary ingestion worker's
    fallback capacity. Jobs created before queue markers existed are considered
    only by the normal ingestion queue.
    """
    from ..services.supabase_service import select_all_trusted

    queue_name = _queue_name(queue)
    row_limit = max(
        1,
        int(limit) if limit is not None else _env_int("OMNIX_DATABASE_QUEUE_FALLBACK_LIMIT", _DEFAULT_DATABASE_FALLBACK_LIMIT),
    )
    rows = await select_all_trusted(
        "jobs",
        "id",
        filters={"status": "queued", f"payload->>{_QUEUE_PAYLOAD_KEY}": queue_name},
        order_by="created_at",
        limit=row_limit,
    )
    job_ids = [str(row["id"]) for row in rows if row.get("id")]

    if queue_name != primary_job_queue() or len(job_ids) >= row_limit:
        return job_ids

    legacy_rows = await select_all_trusted(
        "jobs",
        "id",
        filters={"status": "queued", f"payload->>{_QUEUE_PAYLOAD_KEY}": {"is": "null"}},
        order_by="created_at",
        limit=row_limit - len(job_ids),
    )
    job_ids.extend(str(row["id"]) for row in legacy_rows if row.get("id"))
    return job_ids


async def recover_missing_queued_jobs(
    *,
    queue: str | None = None,
    min_age_seconds: float | None = None,
    limit: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    Requeue DB-persisted jobs that are still status='queued' but absent from Redis.

    The scanner only considers jobs older than the configured grace period to avoid
    racing the normal enqueue path between DB insert and Redis push. Repeated scans
    are idempotent because each job id is compared with the Redis list before push,
    and real Redis uses a single Lua script for the final check-and-push operation.
    """
    from ..services.supabase_service import select_all_trusted

    queue_name = _queue_name(queue)
    age_seconds = (
        min_age_seconds
        if min_age_seconds is not None
        else _env_float("OMNIX_QUEUE_RECOVERY_MIN_AGE_SECONDS", _DEFAULT_QUEUE_RECOVERY_MIN_AGE_SECONDS)
    )
    row_limit = limit if limit is not None else _env_int("OMNIX_QUEUE_RECOVERY_LIMIT", _DEFAULT_QUEUE_RECOVERY_LIMIT)
    threshold = (datetime.now(timezone.utc) - timedelta(seconds=age_seconds)).isoformat()

    rows = await select_all_trusted(
        "jobs",
        "id,status,created_at,payload",
        filters={"status": "queued", "created_at": {"lt": threshold}},
        order_by="created_at",
        limit=row_limit,
    )

    redis = get_redis()
    queued_ids = {
        _decode_redis_value(item)
        for item in await _await_redis_operation(redis.lrange(queue_name, 0, -1))
    }

    already_queued = 0
    other_queue_jobs = 0
    missing = 0
    requeued = 0
    failed = 0

    for row in rows:
        if queue_name_for_payload(row.get("payload")) != queue_name:
            other_queue_jobs += 1
            continue
        job_id = str(row.get("id") or "")
        if not job_id:
            continue
        if job_id in queued_ids:
            already_queued += 1
            continue

        missing += 1
        if dry_run:
            continue

        try:
            if await _lpush_if_absent(redis, queue_name, job_id, queued_ids):
                requeued += 1
            else:
                already_queued += 1
        except Exception:
            failed += 1
            logger.exception("Failed to recover queued job %s into Redis queue %s.", job_id, queue_name)

    status = "ok"
    if failed:
        status = "partial_failure"
    elif missing and dry_run:
        status = "recovery_needed"

    return {
        "status": status,
        "queue": queue_name,
        "dry_run": dry_run,
        "min_age_seconds": age_seconds,
        "scanned_jobs": len(rows),
        "redis_queued_jobs": len(queued_ids),
        "already_queued_jobs": already_queued,
        "other_queue_jobs": other_queue_jobs,
        "missing_jobs": missing,
        "requeued_jobs": requeued,
        "failed_requeue_jobs": failed,
    }


async def enqueue_job(payload: Dict[str, Any], queue: str | None = None) -> str:
    """
    Create a jobs table row (trusted) and push its id to the Redis wake-up queue.

    Safety contract:
    - DB row is always written first. If Redis push fails, the job row remains
      in the DB with status='queued' and can be recovered by a future scan.
    - If the DB write fails, we log and continue without Redis push, so we do
      not push an orphan job_id that has no corresponding DB row.
    - Redis unavailability does NOT silently swallow the job — the DB row
      remains authoritative and a worker can pick it up through database fallback.
    """
    queue_name = queue or queue_name_for_payload(payload)
    job_id = str(uuid.uuid4())
    record = {
        "id": job_id,
        "type": payload.get("type"),
        "status": "queued",
        "payload": {**payload, _QUEUE_PAYLOAD_KEY: queue_name},
        "progress": 0,
        "attempts": 0,
    }

    # Step 1: Persist to DB first. If this fails, skip Redis push.
    db_ok = False
    try:
        from ..services.supabase_service import insert_one_trusted

        await insert_one_trusted("jobs", record)
        db_ok = True
    except Exception:
        logger.exception(
            "Failed to insert job row into DB; job %s NOT pushed to Redis to avoid orphan queue entry.",
            job_id,
        )

    if not db_ok:
        raise JobEnqueueError(f"Job {job_id} could not be persisted to DB; enqueue aborted.", job_id=job_id, persisted=False)

    # Step 2: Push to Redis. If Redis is down, the DB row is the recovery source.
    try:
        await push_job_id(job_id, queue=queue_name)
        logger.info("Enqueued job %s to %s", job_id, queue_name)
    except Exception:
        logger.exception(
            "Failed to push job %s to Redis queue %s. "
            "Job row exists in DB with status='queued' and remains eligible for worker fallback.",
            job_id,
            queue_name,
        )
        raise JobEnqueueError(
            f"Job {job_id} was persisted but could not be pushed to Redis queue {queue_name}.",
            job_id=job_id,
            persisted=True,
        )

    return job_id
