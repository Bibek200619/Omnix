from __future__ import annotations

import pytest

from backend.app.rag.chunking import chunk_text, split_text_into_chunks
from backend.app.rag.ingestion import RAGIngestionPipeline
from backend.app.services.supabase_service import SupabaseServiceError
from backend.app.rag.ingestion_service import parse_document_bytes
from backend.app.rag.models import ParsedDocument, ParsedSection
from backend.app.rag.token_utils import count_tokens
from backend.app.rag.vector_store_base import VectorStore


def test_chunk_text_uses_overlap_and_metadata() -> None:
    text = " ".join(f"token-{index}" for index in range(1600))

    chunks = chunk_text(text, chunk_size=120, overlap=60, min_chunk_size=30, metadata={"file_id": "file-1"})

    assert len(chunks) > 1
    assert chunks[0]["chunk_index"] == 0
    assert chunks[0]["metadata"]["file_id"] == "file-1"
    assert chunks[0]["token_count"] <= 120

    first_tail = chunks[0]["content"].split()[-20:]
    second_head = chunks[1]["content"].split()[:20]
    assert first_tail == second_head


def test_split_text_into_chunks_remains_backward_compatible() -> None:
    chunks = split_text_into_chunks("Alpha beta gamma.\n\nDelta epsilon zeta.")

    assert chunks
    assert all(isinstance(chunk, str) for chunk in chunks)


def test_long_unbroken_unicode_respects_token_budget() -> None:
    chunks = chunk_text("汉字" * 50_000, chunk_size=700, overlap=120, min_chunk_size=150)

    assert len(chunks) > 1
    assert max(count_tokens(chunk["content"]) for chunk in chunks) <= 700


def test_markdown_parser_preserves_headings_metadata() -> None:
    parsed = parse_document_bytes(
        b"# Roadmap\n\n## Q1\n\nShip workspace hierarchy.",
        filename="roadmap.md",
        content_type="text/markdown",
    )

    assert parsed.source_type == "markdown"
    assert parsed.metadata["filename"] == "roadmap.md"
    assert parsed.metadata["headings"][0] == {"level": 1, "text": "Roadmap"}
    assert parsed.sections[0].metadata["format"] == "markdown"


def test_ingestion_sanitizes_oversized_metadata() -> None:
    chunks = RAGIngestionPipeline._chunks_from_parsed_document(
        ParsedDocument(
            text="hello world",
            metadata={"huge": "x" * 10_000, "items": list(range(100))},
            sections=[ParsedSection(text="hello world")],
        )
    )

    assert len(chunks[0].metadata["huge"]) == 2048
    assert len(chunks[0].metadata["items"]) == 51


@pytest.mark.asyncio
async def test_ingestion_rejects_excessive_chunk_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    class Store(VectorStore):
        def add_embeddings(self, *args, **kwargs):
            return None

        def search(self, *args, **kwargs):
            return []

    import backend.app.rag.ingestion as ingestion

    monkeypatch.setattr(ingestion, "MAX_INGESTION_CHUNKS", 1)
    pipeline = RAGIngestionPipeline(Store())

    with pytest.raises(RuntimeError):
        await pipeline.ingest_parsed_document(
            ParsedDocument(
                text=" ".join(f"token-{index}" for index in range(1600)),
                sections=[ParsedSection(text=" ".join(f"token-{index}" for index in range(1600)))],
                source_type="text",
            ),
            user_id="user-1",
            document_id="file-1",
        )


@pytest.mark.asyncio
async def test_reingestion_deletes_old_chunks_before_inserting_new(monkeypatch: pytest.MonkeyPatch) -> None:
    class Store(VectorStore):
        def add_embeddings(self, *args, **kwargs):
            return None

        def search(self, *args, **kwargs):
            return []

    events: list[str] = []
    inserted_payloads: list[dict[str, object]] = []

    async def fake_embeddings(texts: list[str]) -> list[list[float]]:
        events.append("embed")
        return [[0.0] * 384 for _ in texts]

    async def fake_select_all_trusted(*args, **kwargs):
        events.append("select_old")
        return [{"id": "old-1"}]

    async def fake_insert_many(table: str, payloads: list[dict[str, object]], *args, **kwargs):
        events.append("insert_new")
        inserted_payloads.extend(payloads)
        return []

    async def fake_delete_many_trusted(*args, **kwargs):
        events.append("delete_old")
        return []

    import backend.app.rag.ingestion as ingestion

    monkeypatch.setattr(ingestion, "get_embeddings_async", fake_embeddings)
    monkeypatch.setattr(ingestion, "select_all_trusted", fake_select_all_trusted)
    monkeypatch.setattr(ingestion, "insert_many", fake_insert_many)
    monkeypatch.setattr(ingestion, "delete_many_trusted", fake_delete_many_trusted)

    pipeline = RAGIngestionPipeline(Store())
    await pipeline.ingest_parsed_document(
        ParsedDocument(
            text="alpha beta gamma " * 300,
            sections=[ParsedSection(text="alpha beta gamma " * 300)],
            source_type="text",
        ),
        user_id="user-1",
        document_id="file-1",
        workspace_id="workspace-1",
    )

    assert events.index("delete_old") < events.index("insert_new")
    assert inserted_payloads
    assert all(payload.get("ingestion_version") for payload in inserted_payloads)


@pytest.mark.asyncio
async def test_insert_document_payloads_bounds_optional_column_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    import backend.app.rag.ingestion as ingestion

    attempts = 0

    async def fake_insert_many(table: str, payloads: list[dict[str, object]]) -> list[dict[str, object]]:
        nonlocal attempts
        attempts += 1
        exc = SupabaseServiceError("Internal server error")
        exc.__cause__ = Exception("column metadata does not exist")
        raise exc

    monkeypatch.setattr(ingestion, "insert_many", fake_insert_many)

    with pytest.raises(RuntimeError, match="metadata"):
        await RAGIngestionPipeline._insert_document_payloads(
            [{"id": "chunk-1", "user_id": "user-1", "metadata": {"a": "b"}}]
        )

    assert attempts <= len(ingestion.OPTIONAL_DOCUMENT_COLUMNS) + 1
