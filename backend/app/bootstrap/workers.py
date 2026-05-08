from __future__ import annotations
import logging
from ..automation.scheduler import AutomationScheduler
from ..runtime.manager import RuntimeManager

logger = logging.getLogger(__name__)

async def initialize():
    logger.info("Initializing Workers and Schedulers...")
    try:
        scheduler = AutomationScheduler.get()
        await scheduler.start()
        RuntimeManager.get().register_worker("main_scheduler", ["automation", "jobs"])
        logger.info("Automation Scheduler started.")
    except Exception as e:
        logger.error(f"Failed to start Automation Scheduler: {e}")
        raise
