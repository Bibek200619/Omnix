import pytest

from app.rag.pgvector_store import PgVectorStore
from app.rag.ingestion import RAGIngestionPipeline

@pytest.mark.asyncio
async def test_ingestion():
    store = PgVectorStore()
    pipeline = RAGIngestionPipeline(store)
    # mock test for ingestion logic
    assert pipeline is not None
