from __future__ import annotations

import logging
from typing import List

from .schemas import ContextPayload, Citation, ContextSourceType

logger = logging.getLogger(__name__)


class ActionsContextManager:
    """Context management for AI actions."""

    def fetch_actions_context(self, payload: ContextPayload) -> List[Citation]:
        citations = []
        if payload.action_context:
            citations.append(
                Citation(
                    source_id="action_context",
                    source_type=ContextSourceType.ACTION,
                    content=f"Action Context: {payload.action_context}",
                )
            )
        return citations
