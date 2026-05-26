from __future__ import annotations

import logging

from .base import ProviderBase
from ..schemas import AssembledContext

logger = logging.getLogger(__name__)


class LocalLLMProvider(ProviderBase):
    """Generic local LLM fallback provider."""

    def __init__(self, model_path: str):
        self.model_path = model_path

    async def generate_response(self, context: AssembledContext, **kwargs) -> str:
        logger.info(f"Local LLM generating response from {self.model_path}")
        return "Local LLM Response Placeholder"

    async def generate_stream(self, context: AssembledContext, **kwargs):
        logger.info(f"Local LLM streaming response from {self.model_path}")
        yield "Local LLM Streaming Placeholder"
