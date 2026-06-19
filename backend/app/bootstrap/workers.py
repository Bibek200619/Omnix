from __future__ import annotations
import logging
import os
from ..automation.scheduler import AutomationScheduler
from ..runtime.manager import RuntimeManager

logger = logging.getLogger(__name__)

async def initialize():
    # Role-based initialization: only start scheduler if explicitly allowed or in worker mode
    role = os.getenv("OMNIX_ROLE", "api")
    
    if role == "worker":
        logger.info("Initializing Workers and Schedulers (Role: worker)...")
        try:
            scheduler = AutomationScheduler.get()
            await scheduler.start()
            RuntimeManager.get().register_worker("main_scheduler", ["automation", "jobs"])
            logger.info("Automation Scheduler started.")
        except Exception as e:
            logger.error(f"Failed to start Automation Scheduler: {e}")
            raise
    else:
        logger.info("Skipping Automation Scheduler initialization (Role: %s)", role)
        # Integrated worker is now automatically registered by RuntimeManager
