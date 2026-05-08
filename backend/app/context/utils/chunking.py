from __future__ import annotations

import logging
from typing import List

logger = logging.getLogger(__name__)


def smart_chunk(text: str, max_tokens: int = 500) -> List[str]:
    """Split text into chunks intelligently, respecting sentence boundaries."""
    # Naive fallback implementation. Should ideally use a real tokenizer.
    if not text:
        return []
        
    chars_per_token = 4
    max_chars = max_tokens * chars_per_token
    
    chunks = []
    current_chunk = []
    current_length = 0
    
    paragraphs = text.split("\n\n")
    for p in paragraphs:
        if current_length + len(p) > max_chars and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk = [p]
            current_length = len(p)
        else:
            current_chunk.append(p)
            current_length += len(p)
            
    if current_chunk:
        chunks.append("\n\n".join(current_chunk))
        
    return chunks
