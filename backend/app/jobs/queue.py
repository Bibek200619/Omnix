from __future__ import annotations

import os
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

try:
    import redis.asyncio as aioredis
except ModuleNotFoundError as exc:
    aioredis = None  # type: ignore[assignment]
    _redis_import_error: ModuleNotFoundError | None = exc
else:
    _redis_import_error = None

logger = logging.getLogger(__name__)

DEFAULT_REDIS_URL = "redis://localhost:6379/0"
REDIS_URL = os.environ.get("REDIS_URL", DEFAULT_REDIS_URL)
_QUEUE_KEY = os.environ.get("OMNIX_JOB_QUEUE", "omnix:jobs")
_DEFAULT_QUEUE_RECOVERY_MIN_AGE_SECONDS = 60.0
_DEFAULT_QUEUE_RECOVERY_LIMIT = 100

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

_redis_client: Any | None = None


class JobEnqueueError(RuntimeError):
    def __init__(self, message: str, *, job_id: str, persisted: bool) -> None:
        super().__init__(message)
        self.job_id = job_id
        self.persisted = persisted


def _configured_redis_url() -> str:
    try:
        from ..settings import get_settings

        return get_settings().REDIS_URL
    except Exception:
        logger.warning("Unable to load configured REDIS_URL; falling back to %s", REDIS_URL)
        return REDIS_URL


def _missing_redis_dependency_error() -> RuntimeError:
    return RuntimeError(
        "The Python package 'redis' is required for Omnix background jobs. "
        "Install backend dependencies with `pip install -r backend/requirements.txt` "
        "or `pip install redis>=5.0.0` in the active backend environment."
    )


def get_redis() -> Any:
    global _redis_client
    if aioredis is None:
        raise _missing_redis_dependency_error() from _redis_import_error

    if _redis_client is None:
        redis_url = _configured_redis_url()
        _redis_client = aioredis.from_url(redis_url, decode_responses=True)
    return _redis_client


def _queue_name(queue: str | None = None) -> str:
    return queue or os.environ.get("OMNIX_JOB_QUEUE", _QUEUE_KEY)


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


def _decode_redis_value(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


async def _lpush_if_absent(redis: Any, queue_name: str, job_id: str, queued_ids: set[str]) -> bool:
    if job_id in queued_ids:
        return False

    eval_script = getattr(redis, "eval", None)
    if callable(eval_script):
        pushed = await eval_script(_LPUSH_IF_ABSENT_SCRIPT, 1, queue_name, job_id)
        queued_ids.add(job_id)
        return bool(int(pushed))

    await redis.lpush(queue_name, job_id)
    queued_ids.add(job_id)
    return True


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
        "id,status,created_at",
        filters={"status": "queued", "created_at": {"lt": threshold}},
        order_by="created_at",
        limit=row_limit,
    )

    redis = get_redis()
    queued_ids = {_decode_redis_value(item) for item in await redis.lrange(queue_name, 0, -1)}

    already_queued = 0
    missing = 0
    requeued = 0
    failed = 0

    for row in rows:
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
        "missing_jobs": missing,
        "requeued_jobs": requeued,
        "failed_requeue_jobs": failed,
    }


async def enqueue_job(payload: Dict[str, Any], queue: str | None = None) -> str:
    """
    Create a jobs table row (trusted) and push job id to Redis queue.

    Safety contract:
    - DB row is always written first. If Redis push fails, the job row remains
      in the DB with status='queued' and can be recovered by a future scan.
    - If the DB write fails, we log and continue without Redis push, so we do
      not push an orphan job_id that has no corresponding DB row.
    - Redis unavailability does NOT silently swallow the job — the DB row
      persists and is detectable via stuck-job detection.
    """
    queue_name = _queue_name(queue)
    job_id = str(uuid.uuid4())
    record = {
        "id": job_id,
        "type": payload.get("type"),
        "status": "queued",
        "payload": payload,
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
        redis = get_redis()
        await redis.lpush(queue_name, job_id)
        logger.info("Enqueued job %s to %s", job_id, queue_name)
    except Exception:
        logger.exception(
            "Failed to push job %s to Redis queue %s. "
            "Job row exists in DB with status='queued' and will be detectable as stuck.",
            job_id,
            queue_name,
        )
        raise JobEnqueueError(
            f"Job {job_id} was persisted but could not be pushed to Redis queue {queue_name}.",
            job_id=job_id,
            persisted=True,
        )

    return job_id
