from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

TOKEN_PATTERN = re.compile(r"\S+")
MAX_FALLBACK_TOKEN_CHARS = 64
FALLBACK_LONG_TOKEN_CHARS = 4


@lru_cache(maxsize=8)
def _tiktoken_encoding(model: str | None) -> Any | None:
    try:
        import tiktoken
    except Exception:
        return None

    try:
        if model:
            return tiktoken.encoding_for_model(model)
    except Exception:
        pass

    try:
        return tiktoken.get_encoding("cl100k_base")
    except Exception:
        return None


def count_tokens(text: str, *, model: str | None = None) -> int:
    """Count tokens with tiktoken when available, falling back to whitespace tokens."""
    if not text:
        return 0

    encoding = _tiktoken_encoding(model)
    if encoding is not None:
        return len(encoding.encode(text))

    return len(token_spans(text))


def token_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for match in TOKEN_PATTERN.finditer(text or ""):
        start, end = match.span()
        if end - start <= MAX_FALLBACK_TOKEN_CHARS:
            spans.append((start, end))
            continue

        cursor = start
        while cursor < end:
            next_cursor = min(cursor + FALLBACK_LONG_TOKEN_CHARS, end)
            spans.append((cursor, next_cursor))
            cursor = next_cursor

    return spans


def trim_to_token_budget(text: str, max_tokens: int) -> str:
    if max_tokens <= 0 or not text:
        return ""

    spans = token_spans(text)
    if not spans:
        return ""

    if count_tokens(text) <= max_tokens:
        return text.strip()

    bound = 1
    while bound <= len(spans):
        char_end = spans[bound - 1][1]
        if count_tokens(text[:char_end]) > max_tokens:
            break
        bound *= 2

    low = max(1, bound // 2)
    high = min(bound, len(spans))
    best_end = 0
    
    while low <= high:
        mid = (low + high) // 2
        char_end = spans[mid - 1][1]
        if count_tokens(text[:char_end]) <= max_tokens:
            best_end = mid
            low = mid + 1
        else:
            high = mid - 1
            
    if best_end == 0:
        return ""
        
    char_end = spans[best_end - 1][1]
    return text[:char_end].strip()


def tail_tokens(text: str, max_tokens: int) -> str:
    if max_tokens <= 0 or not text:
        return ""

    spans = token_spans(text)
    if not spans:
        return ""

    if count_tokens(text) <= max_tokens:
        return text.strip()

    bound = 1
    while bound <= len(spans):
        start_idx = len(spans) - bound
        char_start = spans[start_idx][0]
        if count_tokens(text[char_start:]) > max_tokens:
            break
        bound *= 2

    low = max(0, len(spans) - bound)
    high = min(len(spans) - 1, len(spans) - max(1, bound // 2))
    best_start = len(spans)
    
    while low <= high:
        mid = (low + high) // 2
        char_start = spans[mid][0]
        if count_tokens(text[char_start:]) <= max_tokens:
            best_start = mid
            high = mid - 1
        else:
            low = mid + 1
            
    if best_start == len(spans):
        return ""
        
    char_start = spans[best_start][0]
    return text[char_start:].strip()


def split_by_token_window(
    text: str,
    *,
    chunk_size: int,
    overlap: int,
) -> list[str]:
    if not text.strip():
        return []
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than 0.")
    if overlap < 0:
        raise ValueError("overlap cannot be negative.")
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size.")

    spans = token_spans(text)
    if not spans:
        return []

    if count_tokens(text) <= chunk_size:
        return [text.strip()]

    windows: list[str] = []
    start_idx = 0
    
    while start_idx < len(spans):
        start_char = spans[start_idx][0]
        
        bound = 1
        while start_idx + bound <= len(spans):
            char_end = spans[start_idx + bound - 1][1]
            if count_tokens(text[start_char:char_end]) > chunk_size:
                break
            bound *= 2
            
        low = start_idx + max(1, bound // 2)
        high = min(start_idx + bound, len(spans))
        best_end = low
        
        while low <= high:
            mid = (low + high) // 2
            char_end = spans[mid - 1][1]
            if count_tokens(text[start_char:char_end]) <= chunk_size:
                best_end = mid
                low = mid + 1
            else:
                high = mid - 1
                
        char_end = spans[best_end - 1][1]
        chunk = text[start_char:char_end].strip()
        if chunk:
            windows.append(chunk)
            
        if best_end >= len(spans):
            break
            
        o_bound = 1
        window_len = best_end - start_idx
        while o_bound <= window_len:
            test_start_idx = best_end - o_bound
            test_start_char = spans[test_start_idx][0]
            if count_tokens(text[test_start_char:char_end]) > overlap:
                break
            o_bound *= 2
            
        o_low = max(start_idx + 1, best_end - o_bound)
        o_high = min(best_end - 1, best_end - max(1, o_bound // 2))
        next_start = best_end - 1
        
        while o_low <= o_high:
            o_mid = (o_low + o_high) // 2
            o_start_char = spans[o_mid][0]
            if count_tokens(text[o_start_char:char_end]) <= overlap:
                next_start = o_mid
                o_high = o_mid - 1
            else:
                o_low = o_mid + 1
                
        if next_start <= start_idx:
            next_start = start_idx + 1
            
        start_idx = next_start

    return windows
