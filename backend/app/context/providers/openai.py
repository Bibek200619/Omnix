from __future__ import annotations

import logging

from .base import ProviderBase
from ..schemas import AssembledContext

logger = logging.getLogger(__name__)


class OpenAIProvider(ProviderBase):
    """OpenAI provider implementation."""

    def __init__(self, api_key: str, model: str = "gpt-4o"):
        self.api_key = api_key
        self.model = model

    async def generate_response(self, context: AssembledContext, **kwargs) -> str:
        logger.info(f"OpenAI generating response with model {self.model}")
        return "OpenAI Response Placeholder"

    async def generate_stream(self, context: AssembledContext, **kwargs):
        logger.info(f"OpenAI streaming response with model {self.model}")
        yield "OpenAI Streaming Placeholder"
