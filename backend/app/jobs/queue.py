from __future__ import annotations

import os
import json
import uuid
import logging
import asyncio
from typing import Any, Dict

import redis.asyncio as aioredis

from ..services.supabase_service import insert_one_trusted

logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
_QUEUE_KEY = os.environ.get("OMNIX_JOB_QUEUE", "omnix:jobs")

_redis_client: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


async def enqueue_job(payload: Dict[str, Any], queue: str | None = None) -> str:
    """Create a jobs table row (trusted) and push job id to Redis queue."""
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
    try:
        # Persist job record to DB (trusted insert)
        await insert_one_trusted("jobs", record)
    except Exception:
        logger.exception("Failed to insert job row into DB; continuing and still enqueueing.")

    try:
        redis = get_redis()
        await redis.lpush(queue_name, job_id)
        logger.info("Enqueued job %s to %s", job_id, queue_name)
    except Exception:
        logger.exception("Failed to push job to Redis queue")
        raise

    return job_id
