from __future__ import annotations

import asyncio
import logging
from time import monotonic
from typing import Any

from ..services.supabase_service import (
    select_all_trusted,
)

logger = logging.getLogger(__name__)


class AutomationScheduler:
    _instance: "AutomationScheduler" | None = None
    _REFRESH_SECONDS = 30.0

    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}
        self._running: dict[str, asyncio.Task] = {}
        self._schedules: dict[str, tuple[int, float]] = {}
        self._stop = False

    @classmethod
    def get(cls) -> "AutomationScheduler":
        if cls._instance is None:
            cls._instance = AutomationScheduler()
        return cls._instance

    async def start(self) -> None:
        """Start independent system work and authoritative schedule reconciliation."""
        if self._tasks:
            return
        self._stop = False
        logger.info("Starting AutomationScheduler...")
        self._tasks["system_presence_cleanup"] = asyncio.create_task(
            self._run_periodic(
                "system_presence_cleanup",
                300,
                {
                    "job_type": "cleanup_stale_presence",
                    "workspace_id": None,
                    "name": "System Presence Cleanup",
                },
            )
        )
        self._tasks["schedule_reconciliation"] = asyncio.create_task(
            self._refresh_loop()
        )

    async def _refresh_loop(self) -> None:
        while not self._stop:
            await self._reconcile()
            await asyncio.sleep(self._REFRESH_SECONDS)

    async def _reconcile(self) -> None:
        # Never dispatch cached records if the authoritative read is unavailable.
        try:
            automations = await select_all_trusted(
                "automations",
                "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id",
                unscoped_reason="automation_scheduler_reconciliation",
            )
        except Exception:
            logger.warning(
                "Automation schedule refresh unavailable; no workspace runs dispatched"
            )
            return

        for key, task in tuple(self._running.items()):
            if task.done():
                del self._running[key]

        current = {}
        for row in automations:
            interval = row.get("interval_seconds")
            if (
                row.get("enabled") is True
                and type(interval) is int
                and 1 <= interval <= 31_536_000
                and row.get("job_type") == "daily_summary"
                and all(
                    isinstance(row.get(field), str) and row[field].strip()
                    for field in ("id", "workspace_id", "user_id")
                )
            ):
                current[row["id"]] = row

        for key in self._schedules.keys() - current.keys():
            del self._schedules[key]

        now = monotonic()
        for key, row in current.items():
            interval = row["interval_seconds"]
            previous = self._schedules.get(key)
            if previous is None:
                self._schedules[key] = (interval, now)
            elif previous[0] != interval:
                # Apply interval edits to future runs, without an immediate burst.
                self._schedules[key] = (interval, now + interval)

            running = self._running.get(key)
            if running is not None and not running.done():
                continue
            self._running.pop(key, None)
            if now >= self._schedules[key][1]:
                self._running[key] = asyncio.create_task(
                    self._run_scheduled(key, dict(row))
                )

    async def _run_scheduled(self, key: str, automation: dict[str, Any]) -> None:
        try:
            from ..services.workspace_service import require_workspace_access
            from .workspace_jobs import run_automation_job

            await require_workspace_access(
                automation["workspace_id"], automation["user_id"]
            )
            await run_automation_job(automation)
        except Exception:
            logger.warning("Scheduled workspace automation failed")
        finally:
            current = self._schedules.get(key)
            if current is not None and not self._stop:
                # Preserve the existing completion-plus-interval cadence.
                self._schedules[key] = (current[0], monotonic() + current[0])

    async def _run_periodic(
        self, key: str, interval_seconds: int, automation: dict[str, Any]
    ) -> None:
        """Run scheduler-owned system work, independent of workspace DB state."""
        while not self._stop:
            try:
                # import here to avoid circular imports
                from .workspace_jobs import run_automation_job

                logger.info("Running automation %s", key)
                await run_automation_job(automation)
                # update last_run could be implemented by DB update (left as non-fatal)
            except Exception:
                logger.warning("System automation failed")
            await asyncio.sleep(max(1, interval_seconds))

    async def run_now(self, automation: dict[str, Any]) -> None:
        from .workspace_jobs import run_automation_job

        await run_automation_job(automation)

    async def stop(self) -> None:
        logger.info("Stopping AutomationScheduler...")
        self._stop = True
        tasks = (*self._tasks.values(), *self._running.values())
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._running.clear()
        self._schedules.clear()


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
