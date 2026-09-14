from __future__ import annotations

from typing import Any

import pytest

from app.jobs import ingestion_jobs
from app.services.document_context_service import StoredDocumentChunks
from app.services.document_intelligence_service import ExtractionDiagnostics, ExtractionResult


def _job_row() -> dict[str, Any]:
    return {
        "id": "job-1",
        "type": "ingest_file",
        "payload": {
            "type": "ingest_file",
            "file_id": "file-1",
            "user_id": "user-1",
            "workspace_id": "workspace-1",
        },
    }


def _file_row() -> dict[str, Any]:
    return {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "file_name": "release-note.md",
        "file_type": "text/markdown",
        "storage_path": "supabase://omnix-files/uploads/user-1/release-note.md",
        "metadata": {},
        "processing_job_id": "job-1",
    }


def _searchable_extraction() -> ExtractionResult:
    return ExtractionResult(
        text="Release note\n\nUse async ingestion.",
        diagnostics=ExtractionDiagnostics(
            extractor_used="text",
            extracted_character_count=34,
            text_page_count=1,
            extraction_status="searchable",
        ),
    )


def _install_file_state_fakes(
    monkeypatch: pytest.MonkeyPatch,
    file_row: dict[str, Any],
    statuses: list[str],
) -> None:
    async def fake_select_one(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any] | None:
        assert table == "files"
        assert filters == {"id": "file-1", "user_id": "user-1", "workspace_id": "workspace-1"}
        return dict(file_row)

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "files"
        assert filters == {"id": "file-1", "user_id": "user-1", "workspace_id": "workspace-1"}
        if "processing_status" in payload:
            statuses.append(str(payload["processing_status"]))
        file_row.update(payload)
        return dict(file_row)

    async def fake_read_bytes_from_storage(path: str) -> bytes:
        assert path == "supabase://omnix-files/uploads/user-1/release-note.md"
        return b"# Release note\n\nUse async ingestion."

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", fake_update_one)
    monkeypatch.setattr(ingestion_jobs, "read_bytes_from_storage", fake_read_bytes_from_storage)
    monkeypatch.setattr(ingestion_jobs, "document_likely_requires_ocr", lambda *args: False)
    monkeypatch.setattr(ingestion_jobs, "extract_document_with_diagnostics", lambda *args: _searchable_extraction())


@pytest.mark.asyncio
async def test_chunk_persistence_failure_after_extraction_marks_file_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    file_row = _file_row()
    statuses: list[str] = []
    _install_file_state_fakes(monkeypatch, file_row, statuses)

    async def fail_to_store_chunks(**kwargs: Any) -> StoredDocumentChunks:
        assert kwargs["replace_existing"] is True
        raise RuntimeError("chunk persistence failed")

    monkeypatch.setattr(ingestion_jobs, "store_extracted_text_chunks", fail_to_store_chunks)

    result = await ingestion_jobs.handle_ingest_file(_job_row())

    assert result["status"] == "failed"
    assert "chunk persistence failed" in result["error"]
    assert statuses == ["extracting", "chunking", "failed"]
    assert "searchable" not in statuses
    assert file_row["processing_status"] == "failed"


@pytest.mark.asyncio
async def test_vector_setup_failure_after_chunk_persistence_is_partially_searchable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_row = _file_row()
    statuses: list[str] = []
    _install_file_state_fakes(monkeypatch, file_row, statuses)

    async def fake_store_chunks(**kwargs: Any) -> StoredDocumentChunks:
        assert kwargs["replace_existing"] is True
        return StoredDocumentChunks(chunk_count=1, chunk_ids=["text-chunk-1"], truncated=False)

    def unavailable_vector_store() -> object:
        raise RuntimeError("private vector-store configuration detail")

    monkeypatch.setattr(ingestion_jobs, "store_extracted_text_chunks", fake_store_chunks)
    monkeypatch.setattr(ingestion_jobs, "get_vector_store", unavailable_vector_store)

    result = await ingestion_jobs.handle_ingest_file(_job_row())

    assert result == {
        "status": "failed",
        "processing_status": "partially_searchable",
        "error": ingestion_jobs._PARTIAL_INDEXING_ERROR,
        "chunks": ["text-chunk-1"],
    }
    assert statuses == ["extracting", "chunking", "embedding", "partially_searchable"]
    assert "searchable" not in statuses
    assert "private vector-store" not in file_row["processing_error"]
    assert file_row["metadata"]["vector_index_status"] == "failed"


@pytest.mark.asyncio
async def test_embedding_failure_is_retryable_and_replaces_existing_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    file_row = _file_row()
    statuses: list[str] = []
    stored_chunk_calls: list[dict[str, Any]] = []
    pipeline_calls: list[dict[str, Any]] = []
    _install_file_state_fakes(monkeypatch, file_row, statuses)

    async def fake_store_chunks(**kwargs: Any) -> StoredDocumentChunks:
        stored_chunk_calls.append(kwargs)
        return StoredDocumentChunks(chunk_count=1, chunk_ids=["text-chunk-1"], truncated=False)

    class FlakyPipeline:
        attempts = 0

        def __init__(self, vector_store: object) -> None:
            assert vector_store is not None

        async def ingest_text(self, *args: Any, **kwargs: Any) -> tuple[int, list[str]]:
            pipeline_calls.append(kwargs)
            FlakyPipeline.attempts += 1
            if FlakyPipeline.attempts == 1:
                raise RuntimeError("embedding provider timed out")
            return 1, ["vector-chunk-2"]

    async def fake_warm_up_provider() -> object:
        return object()

    monkeypatch.setattr(ingestion_jobs, "store_extracted_text_chunks", fake_store_chunks)
    monkeypatch.setattr(ingestion_jobs, "get_vector_store", lambda: object())
    monkeypatch.setattr(ingestion_jobs, "RAGIngestionPipeline", FlakyPipeline)
    monkeypatch.setattr("app.embeddings.provider.warm_up_default_provider", fake_warm_up_provider)

    first_result = await ingestion_jobs.handle_ingest_file(_job_row())
    second_result = await ingestion_jobs.handle_ingest_file(_job_row())

    assert first_result["status"] == "failed"
    assert first_result["processing_status"] == "partially_searchable"
    assert second_result == {
        "status": "completed",
        "processing_status": "searchable",
        "chunks": ["vector-chunk-2"],
    }
    assert statuses == [
        "extracting",
        "chunking",
        "embedding",
        "partially_searchable",
        "extracting",
        "chunking",
        "embedding",
        "searchable",
    ]
    assert all(call["replace_existing"] is True for call in stored_chunk_calls)
    assert all(call["replace_existing"] is True for call in pipeline_calls)
    assert file_row["processing_status"] == "searchable"
    assert file_row["processing_error"] is None
    assert file_row["metadata"]["vector_index_status"] == "ready"
