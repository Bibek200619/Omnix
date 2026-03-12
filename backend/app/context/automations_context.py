from __future__ import annotations

import logging
from typing import List

from .schemas import ContextPayload, Citation, ContextSourceType

logger = logging.getLogger(__name__)


class AutomationsContextManager:
    """Context management for automations."""

    def fetch_automations_context(self, payload: ContextPayload) -> List[Citation]:
        citations = []
        if payload.automation_context:
            citations.append(
                Citation(
                    source_id="automation_context",
                    source_type=ContextSourceType.AUTOMATION,
                    content=f"Automation Context: {payload.automation_context}",
                )
            )
        return citations
