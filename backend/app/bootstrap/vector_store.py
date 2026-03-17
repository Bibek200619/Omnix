from __future__ import annotations
import logging
from ..rag.startup import initialize_vector_store

logger = logging.getLogger(__name__)

async def initialize():
    logger.info("Initializing Vector Store...")
    await initialize_vector_store()
    logger.info("Vector Store initialized.")
