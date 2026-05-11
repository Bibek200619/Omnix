from __future__ import annotations

import logging

from .base import ProviderBase
from ..schemas import AssembledContext

logger = logging.getLogger(__name__)


class OllamaProvider(ProviderBase):
    """Ollama provider implementation."""

    def __init__(self, base_url: str = "http://localhost:11434", model: str = "phi3:mini"):
        self.base_url = base_url
        self.model = model

    async def generate_response(self, context: AssembledContext, **kwargs) -> str:
        # Implementation for Ollama goes here
        # E.g., making HTTP requests to self.base_url
        logger.info(f"Ollama generating response with model {self.model}")
        return "Ollama Response Placeholder"

    async def generate_stream(self, context: AssembledContext, **kwargs):
        logger.info(f"Ollama streaming response with model {self.model}")
        yield "Ollama Streaming Placeholder"
