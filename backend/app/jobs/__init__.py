# Jobs package
from .queue import enqueue_job, get_redis, REDIS_URL  # type: ignore
from .ingestion_jobs import handle_ingest_file  # type: ignore
from .automation_jobs import handle_run_automation  # type: ignore


def run_worker(*args, **kwargs):  # type: ignore
    from .worker import run_worker as _run_worker

    return _run_worker(*args, **kwargs)


__all__ = ["enqueue_job", "get_redis", "run_worker", "handle_ingest_file", "handle_run_automation"]
