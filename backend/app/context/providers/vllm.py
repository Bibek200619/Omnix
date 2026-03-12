from __future__ import annotations

import logging
from typing import Any, Dict

from .base import ProviderBase
from ..schemas import AssembledContext

logger = logging.getLogger(__name__)


class VLLMProvider(ProviderBase):
    """vLLM provider implementation."""

    def __init__(self, base_url: str, model: str):
        self.base_url = base_url
        self.model = model

    async def generate_response(self, context: AssembledContext, **kwargs) -> str:
        logger.info(f"vLLM generating response with model {self.model}")
        return "vLLM Response Placeholder"

    async def generate_stream(self, context: AssembledContext, **kwargs):
        logger.info(f"vLLM streaming response with model {self.model}")
        yield "vLLM Streaming Placeholder"
