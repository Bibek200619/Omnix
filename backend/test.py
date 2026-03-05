from app.rag.vector_store import FAISSStore
from app.rag.ingestion import RAGIngestionPipeline

store = FAISSStore()
pipeline = RAGIngestionPipeline(store)

text = "Artificial Intelligence is transforming the world. " * 50

count, ids = pipeline.ingest_text(text)

print(count)
print(ids[:3])