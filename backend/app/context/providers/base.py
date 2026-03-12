from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Dict

from ..schemas import AssembledContext

logger = logging.getLogger(__name__)


class ProviderBase(ABC):
    """Abstract base class for all LLM providers."""

    @abstractmethod
    async def generate_response(self, context: AssembledContext, **kwargs) -> str:
        """Generate a response using the provider's specific API."""
        pass
        
    @abstractmethod
    async def generate_stream(self, context: AssembledContext, **kwargs):
        """Generate a streaming response using the provider's specific API."""
        pass
