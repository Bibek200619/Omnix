import time
from backend.app.rag.token_utils import count_tokens, token_spans

text = " ".join(f"token-{i}" for i in range(1600))
spans = token_spans(text)

start = time.time()
current = ""
for span in spans:
    current = text[span[0]:span[1]] + current
    count = count_tokens(current)
end = time.time()
print(f"Time: {end - start:.4f}s")
