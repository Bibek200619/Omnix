from __future__ import annotations
import logging
from ..settings import get_settings

logger = logging.getLogger(__name__)

async def initialize():
    settings = get_settings()
    if settings.ENABLE_TRACING:
        logger.info(f"Initializing Tracing with exporter: {settings.TRACING_EXPORTER}")
        # Tracing initialization logic
    if settings.ENABLE_METRICS:
        logger.info("Initializing Metrics...")
        # Metrics initialization logic
