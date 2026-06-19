from __future__ import annotations

from typing import Any


def run_worker(*args, **kwargs):  # type: ignore
    from .worker import run_worker as _run_worker

    return _run_worker(*args, **kwargs)


def __getattr__(name: str) -> Any:
    if name in {"enqueue_job", "get_redis", "REDIS_URL"}:
        from . import queue

        return getattr(queue, name)
    if name == "handle_ingest_file":
        from .ingestion_jobs import handle_ingest_file

        return handle_ingest_file
    if name == "handle_run_automation":
        from .automation_jobs import handle_run_automation

        return handle_run_automation
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "REDIS_URL",
    "enqueue_job",
    "get_redis",
    "run_worker",
    "handle_ingest_file",
    "handle_run_automation",
]
