from __future__ import annotations
import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from fastapi import Request, Response
from ..db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_LOG_EXECUTOR = ThreadPoolExecutor(max_workers=5, thread_name_prefix="api_logger")
_MAX_BACKGROUND_LOG_TASKS = 100
_background_tasks: set[asyncio.Task[None]] = set()
_api_log_metrics: dict[str, int | str | None] = {
    "enqueued_total": 0,
    "written_total": 0,
    "failed_total": 0,
    "dropped_total": 0,
    "last_failure_at": None,
    "last_drop_at": None,
}

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _insert_api_log_sync(log_payload: dict[str, Any]) -> bool:
    try:
        get_supabase().table("api_logs").insert({
            "endpoint": log_payload["endpoint"],
            "status": log_payload["status"],
            "response_time_ms": log_payload["response_time_ms"],
            "user_id": log_payload["user_id"],
            "created_at": log_payload["created_at"],
        }).execute()
    except Exception:
        logger.warning("Skipping API log write for endpoint '%s'.", log_payload["endpoint"])
        return False
    return True


def _increment_api_log_metric(name: str) -> int:
    value = int(_api_log_metrics[name] or 0) + 1
    _api_log_metrics[name] = value
    return value


def get_api_logging_health() -> dict[str, Any]:
    pending_tasks = len(_background_tasks)
    failed_total = int(_api_log_metrics["failed_total"] or 0)
    dropped_total = int(_api_log_metrics["dropped_total"] or 0)
    if failed_total or dropped_total:
        status = "degraded"
    elif pending_tasks >= int(_MAX_BACKGROUND_LOG_TASKS * 0.8):
        status = "warning"
    else:
        status = "healthy"

    return {
        "status": status,
        "pending_tasks": pending_tasks,
        "max_pending_tasks": _MAX_BACKGROUND_LOG_TASKS,
        **_api_log_metrics,
    }

async def _write_api_log(log_payload: dict[str, Any]) -> None:
    try:
        loop = asyncio.get_running_loop()
        written = await loop.run_in_executor(_LOG_EXECUTOR, _insert_api_log_sync, log_payload)
        if written:
            _increment_api_log_metric("written_total")
        else:
            _increment_api_log_metric("failed_total")
            _api_log_metrics["last_failure_at"] = _utc_now_iso()
    except Exception:
        _increment_api_log_metric("failed_total")
        _api_log_metrics["last_failure_at"] = _utc_now_iso()
        logger.exception("API log background write failed.")

def _fire_and_forget_log(log_payload: dict[str, Any]) -> None:
    if len(_background_tasks) >= _MAX_BACKGROUND_LOG_TASKS:
        dropped_total = _increment_api_log_metric("dropped_total")
        _api_log_metrics["last_drop_at"] = _utc_now_iso()
        if dropped_total == 1 or dropped_total % 100 == 0:
            logger.warning(
                "API log backlog saturated; events are being dropped | pending=%d | limit=%d | dropped_total=%d",
                len(_background_tasks),
                _MAX_BACKGROUND_LOG_TASKS,
                dropped_total,
            )
        return
    task = asyncio.create_task(_write_api_log(log_payload))
    _increment_api_log_metric("enqueued_total")
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

async def api_logging_middleware(request: Request, call_next) -> Response:
    started_at = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        try:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            user_claims = getattr(request.state, "user", None)
            user_id = user_claims.get("sub") if isinstance(user_claims, dict) else None
            _fire_and_forget_log({
                "endpoint": request.url.path,
                "status": status_code,
                "response_time_ms": duration_ms,
                "user_id": user_id,
                "created_at": _utc_now_iso(),
            })
        except Exception:
            logger.exception("Failed to dispatch API log.")
