from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable

from ..services.supabase_service import (
    select_all_trusted,
)

logger = logging.getLogger(__name__)


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
        try:
            # load automations (trusted reader)
            automations = await select_all_trusted("automations", "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id")
        except Exception as exc:
            logger.exception("Failed to load automations: %s", exc)
            automations = []

        for a in automations:
            if a.get("enabled"):
                sched_key = str(a.get("id"))
                interval = a.get("interval_seconds") or 0
                if interval and sched_key not in self._tasks:
                    logger.info("Scheduling automation %s every %s seconds", sched_key, interval)
                    t = asyncio.create_task(self._run_periodic(sched_key, interval, a))
                    self._tasks[sched_key] = t
        logger.info("AutomationScheduler started with %d tasks", len(self._tasks))

    async def _run_periodic(self, key: str, interval_seconds: int, automation: dict[str, Any]) -> None:
        """Run a periodic automation until stopped or disabled."""
        while not self._stop:
            try:
                # import here to avoid circular imports
                from .workspace_jobs import run_automation_job

                logger.info("Running automation %s", key)
                await run_automation_job(automation)
                # update last_run could be implemented by DB update (left as non-fatal)
            except Exception as exc:
                logger.exception("Automation %s failed: %s", key, exc)
            await asyncio.sleep(max(1, interval_seconds))

    async def run_now(self, automation: dict[str, Any]) -> None:
        from .workspace_jobs import run_automation_job

        await run_automation_job(automation)

    async def stop(self) -> None:
        logger.info("Stopping AutomationScheduler...")
        self._stop = True
        for k, t in list(self._tasks.items()):
            t.cancel()
        self._tasks.clear()


async def run_job_now(automation: dict[str, Any]) -> None:
    await AutomationScheduler.get().run_now(automation)
