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


@pytest.mark.asyncio
async def test_ingest_file_updates_processing_statuses(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    stored_bytes = b"# Release note\n\nUse async ingestion."
    file_row: dict[str, Any] = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "file_name": "release-note.md",
        "file_type": "text/markdown",
        "storage_path": "supabase://omnix-files/uploads/user-1/release-note.md",
        "metadata": {},
        "processing_job_id": "job-1",
    }
    statuses: list[str] = []

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

    def fake_extract(filename: str, file_type: str | None, data: bytes) -> ExtractionResult:
        assert filename == "release-note.md"
        assert data == stored_bytes
        return ExtractionResult(
            text="Release note\n\nUse async ingestion.",
            diagnostics=ExtractionDiagnostics(
                extractor_used="text",
                extracted_character_count=34,
                text_page_count=1,
                extraction_status="searchable",
            ),
        )

    async def fake_store_chunks(**kwargs: Any) -> StoredDocumentChunks:
        assert kwargs["file_id"] == "file-1"
        assert kwargs["workspace_id"] == "workspace-1"
        return StoredDocumentChunks(chunk_count=1, chunk_ids=["chunk-1"], truncated=False)

    class FakePipeline:
        def __init__(self, vector_store: object) -> None:
            assert vector_store is not None

        async def ingest_text(self, *args: Any, **kwargs: Any) -> tuple[int, list[str]]:
            assert kwargs["document_id"] == "file-1"
            assert kwargs["workspace_id"] == "workspace-1"
            assert kwargs["replace_existing"] is True
            return 1, ["embedded-chunk-1"]

    async def fake_warm_up_provider() -> object:
        return object()

    async def fake_read_bytes_from_storage(path: str) -> bytes:
        assert path == "supabase://omnix-files/uploads/user-1/release-note.md"
        return stored_bytes

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", fake_update_one)
    monkeypatch.setattr(ingestion_jobs, "read_bytes_from_storage", fake_read_bytes_from_storage)
    monkeypatch.setattr(ingestion_jobs, "document_likely_requires_ocr", lambda *args: False)
    monkeypatch.setattr(ingestion_jobs, "extract_document_with_diagnostics", fake_extract)
    monkeypatch.setattr(ingestion_jobs, "store_extracted_text_chunks", fake_store_chunks)
    monkeypatch.setattr(ingestion_jobs, "get_vector_store", lambda: object())
    monkeypatch.setattr(ingestion_jobs, "RAGIngestionPipeline", FakePipeline)
    monkeypatch.setattr("app.embeddings.provider.warm_up_default_provider", fake_warm_up_provider)

    result = await ingestion_jobs.handle_ingest_file(_job_row())

    assert result["status"] == "completed"
    assert result["processing_status"] == "searchable"
    assert statuses == ["extracting", "searchable", "searchable"]
    assert file_row["processing_status"] == "searchable"
    assert file_row["metadata"]["text_chunk_count"] == 1
    assert file_row["metadata"]["embedded_chunk_count"] == 1


@pytest.mark.asyncio
async def test_ingest_file_marks_failed_when_extraction_fails(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    file_row: dict[str, Any] = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "file_name": "blank.md",
        "file_type": "text/markdown",
        "storage_path": "supabase://omnix-files/uploads/user-1/blank.md",
        "metadata": {},
    }
    statuses: list[str] = []

    async def fake_select_one(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any] | None:
        assert filters == {"id": "file-1", "user_id": "user-1", "workspace_id": "workspace-1"}
        return dict(file_row)

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        assert filters == {"id": "file-1", "user_id": "user-1", "workspace_id": "workspace-1"}
        if "processing_status" in payload:
            statuses.append(str(payload["processing_status"]))
        file_row.update(payload)
        return dict(file_row)

    def fake_extract(filename: str, file_type: str | None, data: bytes) -> ExtractionResult:
        return ExtractionResult(
            text="",
            diagnostics=ExtractionDiagnostics(
                extractor_used="text",
                extraction_status="extraction_failed",
                extraction_failure_reason="No readable text was extracted.",
            ),
        )

    async def fake_read_bytes_from_storage(path: str) -> bytes:
        assert path == "supabase://omnix-files/uploads/user-1/blank.md"
        return b""

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", fake_update_one)
    monkeypatch.setattr(ingestion_jobs, "read_bytes_from_storage", fake_read_bytes_from_storage)
    monkeypatch.setattr(ingestion_jobs, "document_likely_requires_ocr", lambda *args: False)
    monkeypatch.setattr(ingestion_jobs, "extract_document_with_diagnostics", fake_extract)

    result = await ingestion_jobs.handle_ingest_file(_job_row())

    assert result["status"] == "failed"
    assert result["processing_status"] == "failed"
    assert "No readable text" in result["error"]
    assert statuses == ["extracting", "failed"]
    assert file_row["processing_status"] == "failed"
    assert file_row["processing_error"] == "No readable text was extracted."


@pytest.mark.asyncio
async def test_ingest_file_marks_ocr_required_without_retrying(monkeypatch: pytest.MonkeyPatch) -> None:
    file_row: dict[str, Any] = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "file_name": "scan.pdf",
        "file_type": "application/pdf",
        "storage_path": "supabase://omnix-files/uploads/user-1/scan.pdf",
        "metadata": {},
    }
    statuses: list[str] = []

    async def fake_select_one(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any] | None:
        return dict(file_row)

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        if "processing_status" in payload:
            statuses.append(str(payload["processing_status"]))
        file_row.update(payload)
        return dict(file_row)

    async def fake_read_bytes_from_storage(path: str) -> bytes:
        return b"%PDF"

    def fake_extract(filename: str, file_type: str | None, data: bytes) -> ExtractionResult:
        return ExtractionResult(
            text="",
            diagnostics=ExtractionDiagnostics(
                extractor_used="pypdf",
                extraction_status="ocr_required",
                extraction_failure_reason="This PDF contains no readable text layer. OCR is required.",
            ),
        )

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", fake_update_one)
    monkeypatch.setattr(ingestion_jobs, "read_bytes_from_storage", fake_read_bytes_from_storage)
    monkeypatch.setattr(ingestion_jobs, "document_likely_requires_ocr", lambda *args: False)
    monkeypatch.setattr(ingestion_jobs, "extract_document_with_diagnostics", fake_extract)

    result = await ingestion_jobs.handle_ingest_file(_job_row())

    assert result["status"] == "completed"
    assert result["processing_status"] == "ocr_required"
    assert statuses == ["extracting", "ocr_required"]
    assert file_row["processing_status"] == "ocr_required"


@pytest.mark.asyncio
async def test_ingest_file_exposes_ocr_running_before_success(monkeypatch: pytest.MonkeyPatch) -> None:
    file_row: dict[str, Any] = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "file_name": "scan.pdf",
        "file_type": "application/pdf",
        "storage_path": "supabase://omnix-files/uploads/user-1/scan.pdf",
        "metadata": {},
    }
    statuses: list[str] = []

    async def fake_select_one(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any] | None:
        return dict(file_row)

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        if "processing_status" in payload:
            statuses.append(str(payload["processing_status"]))
        file_row.update(payload)
        return dict(file_row)

    async def fake_read_bytes_from_storage(path: str) -> bytes:
        return b"%PDF"

    def fake_extract(filename: str, file_type: str | None, data: bytes) -> ExtractionResult:
        return ExtractionResult(
            text="OCR extracted contract terms and obligations.",
            diagnostics=ExtractionDiagnostics(
                extractor_used="pypdf+tesseract",
                extraction_status="searchable",
                ocr_used=True,
                ocr_character_count=42,
            ),
        )

    async def fake_store_chunks(**kwargs: Any) -> StoredDocumentChunks:
        return StoredDocumentChunks(chunk_count=1, chunk_ids=["chunk-1"], truncated=False)

    class FakePipeline:
        def __init__(self, vector_store: object) -> None:
            pass

        async def ingest_text(self, *args: Any, **kwargs: Any) -> tuple[int, list[str]]:
            return 1, ["embedded-chunk-1"]

    async def fake_warm_up_provider() -> object:
        return object()

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", fake_update_one)
    monkeypatch.setattr(ingestion_jobs, "read_bytes_from_storage", fake_read_bytes_from_storage)
    monkeypatch.setattr(ingestion_jobs, "document_likely_requires_ocr", lambda *args: True)
    monkeypatch.setattr(ingestion_jobs, "extract_document_with_diagnostics", fake_extract)
    monkeypatch.setattr(ingestion_jobs, "store_extracted_text_chunks", fake_store_chunks)
    monkeypatch.setattr(ingestion_jobs, "get_vector_store", lambda: object())
    monkeypatch.setattr(ingestion_jobs, "RAGIngestionPipeline", FakePipeline)
    monkeypatch.setattr("app.embeddings.provider.warm_up_default_provider", fake_warm_up_provider)

    result = await ingestion_jobs.handle_ingest_file(_job_row())

    assert result["status"] == "completed"
    assert result["processing_status"] == "searchable"
    assert statuses == ["extracting", "ocr_running", "searchable", "searchable"]


@pytest.mark.asyncio
async def test_ingest_file_scopes_lookup_and_failure_update_to_job_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    select_filters: list[dict[str, Any]] = []
    update_filters: list[dict[str, Any]] = []

    async def fake_select_one(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any] | None:
        assert table == "files"
        select_filters.append(filters)
        return None

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any] | None:
        assert table == "files"
        update_filters.append(filters)
        return None

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", fake_update_one)

    result = await ingestion_jobs.handle_ingest_file(
        {
            "id": "job-2",
            "type": "ingest_file",
            "payload": {
                "type": "ingest_file",
                "file_id": "file-1",
                "user_id": "user-1",
                "workspace_id": "workspace-2",
            },
        }
    )

    scoped_filters = {"id": "file-1", "user_id": "user-1", "workspace_id": "workspace-2"}
    assert result["status"] == "failed"
    assert "File not found" in result["error"]
    assert select_filters == [scoped_filters]
    assert update_filters == [scoped_filters]


@pytest.mark.asyncio
async def test_ingest_file_private_upload_uses_null_workspace_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    select_filters: list[dict[str, Any]] = []
    update_filters: list[dict[str, Any]] = []

    async def fake_select_one(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any] | None:
        assert table == "files"
        select_filters.append(filters)
        return None

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any] | None:
        assert table == "files"
        update_filters.append(filters)
        return None

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", fake_select_one)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", fake_update_one)

    result = await ingestion_jobs.handle_ingest_file(
        {
            "id": "job-3",
            "type": "ingest_file",
            "payload": {
                "type": "ingest_file",
                "file_id": "file-1",
                "user_id": "user-1",
                "workspace_id": None,
            },
        }
    )

    scoped_filters = {"id": "file-1", "user_id": "user-1", "workspace_id": {"is": None}}
    assert result["status"] == "failed"
    assert "File not found" in result["error"]
    assert select_filters == [scoped_filters]
    assert update_filters == [scoped_filters]
