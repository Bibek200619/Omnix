from backend.app.rag.token_utils import count_tokens, token_spans

def tail_tokens(text: str, max_tokens: int) -> str:
    if max_tokens <= 0 or not text:
        return ""
    spans = token_spans(text)
    if not spans: return ""
    if count_tokens(text) <= max_tokens: return text.strip()
    low, high = 0, len(spans) - 1
    best_start = len(spans) - 1
    while low <= high:
        mid = (low + high) // 2
        char_start = spans[mid][0]
        candidate = text[char_start:]
        if count_tokens(candidate) <= max_tokens:
            best_start = mid
            high = mid - 1
        else:
            low = mid + 1
    return text[spans[best_start][0]:].strip()

def split_by_token_window(text: str, chunk_size: int, overlap: int):
    spans = token_spans(text)
    if not spans: return []
    if count_tokens(text) <= chunk_size: return [text.strip()]
    windows = []
    start_idx = 0
    while start_idx < len(spans):
        low, high = start_idx + 1, len(spans)
        best_end = start_idx + 1
        start_char = spans[start_idx][0]
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
        if chunk: windows.append(chunk)
        if best_end >= len(spans): break
        o_low, o_high = start_idx + 1, best_end - 1
        next_start = best_end - 1
        while o_low <= o_high:
            o_mid = (o_low + o_high) // 2
            o_start_char = spans[o_mid][0]
            if count_tokens(text[o_start_char:char_end]) <= overlap:
                next_start = o_mid
                o_high = o_mid - 1
            else:
                o_low = o_mid + 1
        if next_start <= start_idx: next_start = start_idx + 1
        start_idx = next_start
    return windows

text = " ".join(f"token-{i}" for i in range(1600))
windows = split_by_token_window(text, chunk_size=120, overlap=20)
print("Windows:", len(windows))
print("First tail:", windows[0].split()[-20:])
print("Second head:", windows[1].split()[:20])


def trim_to_token_budget(text: str, max_tokens: int) -> str:
    if max_tokens <= 0 or not text: return ""
    spans = token_spans(text)
    if not spans: return ""
    if count_tokens(text) <= max_tokens: return text.strip()
    low, high = 1, len(spans)
    best_end = 1
    while low <= high:
        mid = (low + high) // 2
        char_end = spans[mid - 1][1]
        if count_tokens(text[:char_end]) <= max_tokens:
            best_end = mid
            low = mid + 1
        else:
            high = mid - 1
    return text[:spans[best_end - 1][1]].strip()

t_tail = tail_tokens(text, max_tokens=20)
print("Tail tokens:", t_tail)
t_trim = trim_to_token_budget(text, max_tokens=20)
print("Trim to budget:", t_trim)
