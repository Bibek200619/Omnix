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
_API_CONTENT_SECURITY_POLICY = (
    "default-src 'none'; base-uri 'none'; form-action 'none'; "
    "frame-ancestors 'none'; object-src 'none'"
)
_DOCS_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "img-src 'self' data: https://fastapi.tiangolo.com; "
    "font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self'"
)
_DOCS_PATHS = {"/docs", "/docs/oauth2-redirect", "/redoc"}
_SECURITY_HEADERS = {
    "Permissions-Policy": "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0",
}
_HSTS_VALUE = "max-age=31536000"
_background_tasks: set[asyncio.Task[None]] = set()
_api_log_metrics: dict[str, int | str | None] = {
    "enqueued_total": 0,
    "written_total": 0,
    "failed_total": 0,
    "backpressured_total": 0,
    "last_failure_at": None,
    "last_backpressure_at": None,
}

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _content_security_policy(path: str) -> str:
    normalized_path = path.rstrip("/") or "/"
    return _DOCS_CONTENT_SECURITY_POLICY if normalized_path in _DOCS_PATHS else _API_CONTENT_SECURITY_POLICY


async def security_headers_middleware(request: Request, call_next) -> Response:
    response = await call_next(request)
    for header, value in _SECURITY_HEADERS.items():
        if header not in response.headers:
            response.headers[header] = value
    if "Content-Security-Policy" not in response.headers:
        response.headers["Content-Security-Policy"] = _content_security_policy(request.url.path)
    if request.url.scheme == "https" and "Strict-Transport-Security" not in response.headers:
        response.headers["Strict-Transport-Security"] = _HSTS_VALUE
    return response


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


def _discard_completed_api_log_tasks() -> None:
    completed = {task for task in tuple(_background_tasks) if task.done()}
    _background_tasks.difference_update(completed)


async def drain_api_log_tasks(*, timeout_seconds: float) -> tuple[int, int]:
    """Wait for app-owned API log writes after the server has drained requests."""
    _discard_completed_api_log_tasks()
    tasks = tuple(_background_tasks)
    if not tasks:
        return 0, 0

    done, pending = await asyncio.wait(tasks, timeout=max(timeout_seconds, 0.0))
    timed_out = len(pending)
    if pending:
        logger.warning(
            "API log shutdown drain timed out; cancelling unfinished writes | pending=%d | timeout_seconds=%.2f",
            timed_out,
            timeout_seconds,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    _background_tasks.difference_update(done)
    _background_tasks.difference_update(pending)
    return len(done), timed_out


def get_api_logging_health() -> dict[str, Any]:
    _discard_completed_api_log_tasks()
    pending_tasks = len(_background_tasks)
    failed_total = int(_api_log_metrics["failed_total"] or 0)
    backpressured_total = int(_api_log_metrics["backpressured_total"] or 0)
    if failed_total:
        status = "degraded"
    elif backpressured_total or pending_tasks >= int(_MAX_BACKGROUND_LOG_TASKS * 0.8):
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

async def _enqueue_api_log(log_payload: dict[str, Any]) -> None:
    backpressured = False
    _discard_completed_api_log_tasks()
    while len(_background_tasks) >= _MAX_BACKGROUND_LOG_TASKS:
        if not backpressured:
            backpressured_total = _increment_api_log_metric("backpressured_total")
            _api_log_metrics["last_backpressure_at"] = _utc_now_iso()
            backpressured = True
            if backpressured_total == 1 or backpressured_total % 100 == 0:
                logger.warning(
                    "API log backlog saturated; applying request backpressure | pending=%d | limit=%d | backpressured_total=%d",
                    len(_background_tasks),
                    _MAX_BACKGROUND_LOG_TASKS,
                    backpressured_total,
                )

        pending_tasks = tuple(_background_tasks)
        if not pending_tasks:
            continue
        await asyncio.wait(pending_tasks, return_when=asyncio.FIRST_COMPLETED)
        _discard_completed_api_log_tasks()

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
            await _enqueue_api_log({
                "endpoint": request.url.path,
                "status": status_code,
                "response_time_ms": duration_ms,
                "user_id": user_id,
                "created_at": _utc_now_iso(),
            })
        except Exception:
            logger.exception("Failed to dispatch API log.")
