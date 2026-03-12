from __future__ import annotations

from typing import List, Dict, Any

def deduplicate_text(texts: List[str]) -> List[str]:
    """Remove exact duplicate text blocks."""
    seen = set()
    unique = []
    for t in texts:
        normalized = t.strip()
        if normalized not in seen:
            seen.add(normalized)
            unique.append(t)
    return unique
