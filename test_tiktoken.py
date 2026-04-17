import tiktoken
from backend.app.rag.token_utils import count_tokens, token_spans, split_by_token_window

text = "汉字" * 50_000
print(f"Total tiktoken count: {count_tokens(text)}")
chunks = split_by_token_window(text, chunk_size=700, overlap=120)
for i, c in enumerate(chunks[:2]):
    print(f"chunk {i} length: {len(c)}")
    print(f"chunk {i} token count: {count_tokens(c)}")
