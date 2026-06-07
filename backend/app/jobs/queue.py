from __future__ import annotations

import os
import uuid
import logging
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

_redis_client: Any | None = None


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
    queue_name = queue or _QUEUE_KEY
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
        raise RuntimeError(f"Job {job_id} could not be persisted to DB; enqueue aborted.")

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
        # Re-raise so the caller knows Redis is unavailable.
        raise

    return job_id
