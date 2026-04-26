from backend.app.rag.embedding import get_embedding

vec = get_embedding("Artificial Intelligence is powerful")

print(len(vec))
print(vec[:5])