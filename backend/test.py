import asyncio

from app.rag.vector_store import FAISSStore
from app.rag.ingestion import RAGIngestionPipeline
from app.rag.retrieval import RAGRetriever
from app.rag.context_builder import ContextBuilder
from app.services.chat_service import ChatService


async def main():
    store = FAISSStore()
    pipeline = RAGIngestionPipeline(store)

    text = "Artificial Intelligence is transforming the world. " * 50

    count, ids, chunks = pipeline.ingest_text(text)
    chunk_store = dict(zip(ids, chunks))

    retriever = RAGRetriever(store, chunk_store)
    builder = ContextBuilder()

    chat = ChatService(retriever, builder)

    response = await chat.generate_response("What is AI?")

    print("\n=== FINAL RESPONSE ===\n")
    print(response)


if __name__ == "__main__":
    asyncio.run(main())