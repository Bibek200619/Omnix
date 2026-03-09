from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from .queue import get_redis
from .ingestion_jobs import handle_ingest_file
from .automation_jobs import handle_run_automation
from ..services.supabase_service import update_one_trusted, select_one_trusted
from ..rag.startup import initialize_vector_store, shutdown_vector_store
from ..embeddings.provider import get_default_provider

logger = logging.getLogger(__name__)


async def _process_job(job_id: str):
    """Fetch job row, mark processing, run handler, update result."""
    try:
        job_row = await select_one_trusted("jobs", "*", {"id": job_id})
        if not job_row:
            logger.warning("Job %s missing in DB; skipping", job_id)
            return

        # Update status to processing
        await update_one_trusted("jobs", {"id": job_id}, {"status": "processing", "attempts": job_row.get("attempts", 0) + 1})

        job_type = job_row.get("type")
        if job_type == "ingest_file":
            result = await handle_ingest_file(job_row)
        elif job_type == "run_automation":
            result = await handle_run_automation(job_row)
        else:
            logger.error("Unknown job type %s for job %s", job_type, job_id)
            result = {"status": "failed", "error": "unknown job type"}

        status = result.get("status", "failed")
        await update_one_trusted("jobs", {"id": job_id}, {"status": status, "progress": 100, "result": result})
        logger.info("Job %s finished with status %s", job_id, status)
    except Exception as exc:
        logger.exception("Processing job %s failed: %s", job_id, exc)
        try:
            await update_one_trusted("jobs", {"id": job_id}, {"status": "failed", "error": str(exc)})
        except Exception:
            logger.exception("Failed to update job row for job %s after exception", job_id)


async def _worker_loop(shutdown_event: asyncio.Event):
    """Main worker lifecycle: initialize infra, then poll Redis and process jobs."""
    # Initialize retrieval/vector store
    try:
        logger.info("Worker startup: initializing vector store...")
        await initialize_vector_store()
        logger.info("Vector store initialized in worker.")
    except Exception as exc:
        logger.exception("Worker startup failed to initialize vector store: %s", exc)
        return

    # Initialize embeddings provider early to validate config and open clients
    try:
        provider = get_default_provider()
        logger.info("Embedding provider instantiated: %s", provider.__class__.__name__)
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

    # Poll loop
    while not shutdown_event.is_set():
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

    try:
        job_row = await select_one_trusted("jobs", "*", {"id": job_id})
        if not job_row:
            logger.warning("Job %s missing in DB; skipping", job_id)
            return
        # Update status to processing

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
        await update_one_trusted(
            "jobs",
            {"id" : job_id},
            {"status": status, "progress": 100, "result": result})
        logger.info("Job %s finished with status %s", job_id, status)
    except Exception as exc:
        logger.exception("Processing job %s failed: %s", job_id, exc)
        

        await update_one_trusted(
            "jobs",
            {"id": job_id},
            {"status": "failed", "error": str(exc)},
        )
        try:
            await update_one_trusted(
                "jobs",
                {"id": job_id},
                {"status": "failed", "error": str(exc)})
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

    asyncio.run(_worker_loop())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker()
