from __future__ import annotations

import asyncio
import json
import logging
import signal
import sys
from typing import Any

from .queue import get_redis
from .ingestion_jobs import handle_ingest_file
from .automation_jobs import handle_run_automation
from ..services.supabase_service import update_one_trusted, select_one_trusted

logger = logging.getLogger(__name__)

_SHUTDOWN = False


def _signal_handler(sig, frame):
    global _SHUTDOWN
    logger.info("Worker shutting down due to signal %s", sig)
    _SHUTDOWN = True


async def _process_job(job_id: str):
    try:
        job_row = await select_one_trusted("jobs", "*", {"id": job_id})
        if not job_row:
            logger.warning("Job %s missing in DB; skipping", job_id)
            return
        # Update status to processing
        await update_one_trusted("jobs", job_id, {"status": "processing", "attempts": job_row.get("attempts", 0) + 1})

        job_type = job_row.get("type")
        if job_type == "ingest_file":
            result = await handle_ingest_file(job_row)
        elif job_type == "run_automation":
            result = await handle_run_automation(job_row)
        else:
            logger.error("Unknown job type %s for job %s", job_type, job_id)
            result = {"status": "failed", "error": "unknown job type"}

        # finalize job
        status = result.get("status")
        await update_one_trusted("jobs", job_id, {"status": status, "progress": 100, "result": result})
        logger.info("Job %s finished with status %s", job_id, status)
    except Exception as exc:
        logger.exception("Processing job %s failed: %s", job_id, exc)
        try:
            await update_one_trusted("jobs", job_id, {"status": "failed", "error": str(exc)})
        except Exception:
            logger.exception("Failed to update job row for job %s after exception", job_id)


async def _worker_loop():
    redis = get_redis()
    queue_name = None
    # get queue name via env
    import os

    queue_name = os.environ.get("OMNIX_JOB_QUEUE", "omnix:jobs")

    logger.info("Worker listening on %s", queue_name)
    while not _SHUTDOWN:
        try:
            item = await redis.brpop(queue_name, timeout=5)
            if not item:
                await asyncio.sleep(0.1)
                continue
            _, job_id = item
            logger.info("Dequeued job %s", job_id)
            await _process_job(job_id)
        except Exception as exc:
            logger.exception("Worker loop error: %s", exc)
            await asyncio.sleep(1)


def run_worker():
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)
    loop = asyncio.get_event_loop()
    try:
        loop.run_until_complete(_worker_loop())
    finally:
        loop.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker()
