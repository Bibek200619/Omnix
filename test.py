from backend.app.rag.chunking import split_text_into_chunks

text = "Artificial Intelligence is transforming the world. " * 100

chunks = split_text_into_chunks(text)

for i, chunk in enumerate(chunks):
    print(f"\n--- Chunk {i+1} ---\n")
    print(chunk)
    print(f"\nLength: {len(chunk)}")