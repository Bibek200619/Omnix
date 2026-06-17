from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from ..services.supabase_service import (
    select_all_trusted,
    update_one_trusted,
)

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_last_run_at(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        text = value.strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _initial_delay_seconds(automation: dict[str, Any], interval_seconds: int | float) -> float:
    try:
        interval = float(interval_seconds)
    except (TypeError, ValueError):
        return 0.0
    if interval <= 0:
        return 0.0

    last_run_at = _parse_last_run_at(automation.get("last_run_at"))
    if last_run_at is None:
        return 0.0

    elapsed = (_utc_now() - last_run_at).total_seconds()
    if elapsed < 0:
        return interval
    return max(0.0, interval - elapsed)


def _automation_timeout_seconds(interval_seconds: int | float) -> float:
    return max(float(interval_seconds) * 0.8, 30.0)


async def _record_last_run(automation: dict[str, Any]) -> None:
    automation_id = str(automation.get("id") or "")
    if not automation_id:
        return
    filters: dict[str, Any] = {"id": automation_id}
    workspace_id = automation.get("workspace_id")
    if workspace_id:
        filters["workspace_id"] = workspace_id
    timestamp = _utc_now_iso()
    try:
        await update_one_trusted(
            "automations",
            filters,
            {"last_run_at": timestamp, "updated_at": timestamp},
        )
        automation["last_run_at"] = timestamp
    except Exception:
        logger.exception("Failed to persist automation last_run_at for %s.", automation_id)


async def _run_automation_once(key: str, interval_seconds: int, automation: dict[str, Any]) -> None:
    from .workspace_jobs import run_automation_job

    timeout = _automation_timeout_seconds(interval_seconds)
    try:
        await asyncio.wait_for(run_automation_job(automation), timeout=timeout)
    except asyncio.TimeoutError:
        logger.critical("Automation %s timed out after %.1f seconds and was cancelled.", key, timeout)
        return
    await _record_last_run(automation)


class AutomationScheduler:
    _instance: "AutomationScheduler" | None = None

    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}
        self._stop = False

    @classmethod
    def get(cls) -> "AutomationScheduler":
        if cls._instance is None:
            cls._instance = AutomationScheduler()
        return cls._instance

    async def start(self) -> None:
        """Start the scheduler: load scheduled automations from DB and schedule them."""
        logger.info("Starting AutomationScheduler...")
        
        # Schedule built-in system tasks
        if "system_presence_cleanup" not in self._tasks:
            logger.info("Scheduling built-in presence cleanup every 300 seconds")
            t = asyncio.create_task(self._run_periodic(
                "system_presence_cleanup", 
                300, 
                {"job_type": "cleanup_stale_presence", "workspace_id": None, "name": "System Presence Cleanup"}
            ))
            self._tasks["system_presence_cleanup"] = t

        automations = []
        try:
            automations = await select_all_trusted(
                "automations",
                "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id,last_run_at",
            )
        except Exception as exc:
            logger.warning(
                "AutomationScheduler skipped DB-backed automations: %s",
                exc,
            )

        for a in automations:
            if a.get("enabled"):
                sched_key = str(a.get("id"))
                interval = a.get("interval_seconds") or 0
                if interval and sched_key not in self._tasks:
                    initial_delay = _initial_delay_seconds(a, interval)
                    logger.info(
                        "Scheduling automation %s every %s seconds%s",
                        sched_key,
                        interval,
                        f" after {initial_delay:.1f}s initial delay" if initial_delay > 0 else "",
                    )
                    t = asyncio.create_task(
                        self._run_periodic(
                            sched_key,
                            interval,
                            a,
                            initial_delay=initial_delay,
                        )
                    )
                    self._tasks[sched_key] = t
        logger.info("AutomationScheduler started with %d tasks", len(self._tasks))

    async def _run_periodic(
        self,
        key: str,
        interval_seconds: int,
        automation: dict[str, Any],
        *,
        initial_delay: float = 0.0,
    ) -> None:
        """Run a periodic automation until stopped or disabled."""
        if initial_delay > 0 and not self._stop:
            await asyncio.sleep(initial_delay)

        while not self._stop:
            try:
                logger.info("Running automation %s", key)
                await _run_automation_once(key, interval_seconds, automation)
            except Exception as exc:
                logger.exception("Automation %s failed: %s", key, exc)
            await asyncio.sleep(max(1, interval_seconds))

    async def run_now(self, automation: dict[str, Any]) -> None:
        from .workspace_jobs import run_automation_job

        await run_automation_job(automation)
        await _record_last_run(automation)

    async def stop(self) -> None:
        logger.info("Stopping AutomationScheduler...")
        self._stop = True
        for k, t in list(self._tasks.items()):
            t.cancel()
        self._tasks.clear()


async def run_job_now(automation: dict[str, Any]) -> None:
    await AutomationScheduler.get().run_now(automation)


async def main():
    """Standalone entry point for the automation scheduler."""
    logging.basicConfig(level=logging.INFO)
    scheduler = AutomationScheduler.get()
    await scheduler.start()
    try:
        # Keep the process alive
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, asyncio.CancelledError):
        await scheduler.stop()

if __name__ == "__main__":
    asyncio.run(main())
