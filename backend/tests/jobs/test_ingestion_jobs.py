from __future__ import annotations

from typing import Any

import pytest

from app.jobs import ingestion_jobs
from app.services.document_intelligence_service import ExtractionDiagnostics, ExtractionResult


@pytest.mark.asyncio
async def test_ingest_file_job_extracts_and_marks_file_searchable(monkeypatch: pytest.MonkeyPatch) -> None:
    file_row = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "file_name": "scan.pdf",
        "file_type": "application/pdf",
        "storage_path": "user-1/scan.pdf",
        "storage_backend": "supabase",
        "metadata": {"extraction_status": "processing"},
        "extraction_status": "processing",
    }
    updates: list[dict[str, Any]] = []
    ingested: list[dict[str, Any]] = []

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]):
        assert table == "files"
        assert filters == {"id": "file-1"}
        return dict(file_row)

    async def fake_load_stored_file_bytes(row: dict[str, Any]) -> bytes:
        assert row["id"] == "file-1"
        return b"%PDF scanned bytes"

    def fake_extract(filename: str, file_type: str | None, data: bytes) -> ExtractionResult:
        assert filename == "scan.pdf"
        return ExtractionResult(
            text="OCR extracted launch plan and implementation details.",
            diagnostics=ExtractionDiagnostics(
                extractor_used="pypdf",
                extracted_character_count=53,
                image_page_count=1,
                text_page_count=0,
                extraction_status="searchable",
                ocr_used=True,
                ocr_character_count=53,
            ),
        )

    async def fake_update_one_trusted(table: str, filters: dict[str, Any], payload: dict[str, Any]):
        updates.append(payload)
        return {**file_row, **payload}

    class FakePipeline:
        def __init__(self, vector_store: object) -> None:
            self.vector_store = vector_store

        async def ingest_text(self, *args: Any, **kwargs: Any):
            ingested.append({"args": args, "kwargs": kwargs})
            return 1, ["chunk-1"]

    async def fake_warm_up_default_provider() -> object:
        return object()

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(ingestion_jobs, "load_stored_file_bytes", fake_load_stored_file_bytes)
    monkeypatch.setattr(ingestion_jobs, "extract_document_with_diagnostics", fake_extract)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(ingestion_jobs, "get_vector_store", lambda: object())
    monkeypatch.setattr(ingestion_jobs, "RAGIngestionPipeline", FakePipeline)

    import app.embeddings.provider as provider

    monkeypatch.setattr(provider, "warm_up_default_provider", fake_warm_up_default_provider)

    result = await ingestion_jobs.handle_ingest_file(
        {
            "payload": {
                "type": "ingest_file",
                "file_id": "file-1",
                "user_id": "user-1",
                "workspace_id": "workspace-1",
            }
        }
    )

    assert result == {"status": "completed", "chunks": ["chunk-1"]}
    assert updates[0]["extraction_status"] == "searchable"
    assert updates[0]["metadata"]["extracted_text_preview"].startswith("OCR extracted launch")
    assert ingested[0]["kwargs"]["replace_existing"] is True
    assert ingested[0]["kwargs"]["workspace_id"] == "workspace-1"
