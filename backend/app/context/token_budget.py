from __future__ import annotations

import logging
from typing import List

from .schemas import Citation

logger = logging.getLogger(__name__)


class TokenBudgetEngine:
    """Dynamic token budgeting and estimation."""

    def __init__(self, max_context_tokens: int = 8000, reserved_completion_tokens: int = 1000):
        self.max_context_tokens = max_context_tokens
        self.reserved_completion_tokens = reserved_completion_tokens
        self.available_tokens = self.max_context_tokens - self.reserved_completion_tokens

    def estimate_tokens(self, text: str) -> int:
        """Naive estimation: ~4 chars per token."""
        return len(text) // 4

    def enforce_budget(self, citations: List[Citation]) -> List[Citation]:
        """Truncate citations to fit within the token budget."""
        budget = self.available_tokens
        current_usage = 0
        approved = []

        for citation in citations:
            tokens = self.estimate_tokens(citation.content)
            if current_usage + tokens > budget:
                # Truncate content to fit remaining
                remaining_tokens = budget - current_usage
                if remaining_tokens > 20: # arbitrary minimum useful size
                    allowed_chars = remaining_tokens * 4
                    citation.content = citation.content[:allowed_chars] + "...[TRUNCATED]"
                    approved.append(citation)
                    current_usage += self.estimate_tokens(citation.content)
                break
            
            approved.append(citation)
            current_usage += tokens
            
        return approved
