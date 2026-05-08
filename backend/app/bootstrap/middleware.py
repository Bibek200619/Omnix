from __future__ import annotations
import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from fastapi import Request, Response
from ..db.supabase import get_supabase

logger = logging.getLogger(__name__)

_LOG_EXECUTOR = ThreadPoolExecutor(max_workers=5, thread_name_prefix="api_logger")
_background_tasks = set()

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _insert_api_log_sync(log_payload: dict[str, Any]) -> None:
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

async def _write_api_log(log_payload: dict[str, Any]) -> None:
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_LOG_EXECUTOR, _insert_api_log_sync, log_payload)
    except Exception:
        pass

def _fire_and_forget_log(log_payload: dict[str, Any]) -> None:
    if len(_background_tasks) >= 100:
        return
    task = asyncio.create_task(_write_api_log(log_payload))
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
