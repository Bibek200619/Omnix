from backend.app.rag.chunking import chunk_text
text = " ".join(f"token-{index}" for index in range(1600))
chunks = chunk_text(text, chunk_size=120, overlap=20, min_chunk_size=30, metadata={"file_id": "file-1"})
for i, c in enumerate(chunks[:2]):
    print(f"Chunk {i}:", c["content"].split()[:5], "...", c["content"].split()[-5:])
    
first_tail = chunks[0]["content"].split()[-20:]
second_head = chunks[1]["content"].split()[:20]
print("first_tail:", first_tail)
print("second_head:", second_head)
