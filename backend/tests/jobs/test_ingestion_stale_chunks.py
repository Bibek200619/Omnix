from __future__ import annotations

from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.jobs import ingestion_jobs
from app.services import document_context_service as docs
from app.services.document_intelligence_service import (
    ExtractionDiagnostics,
    ExtractionResult,
)


@pytest.fixture
def document_rows(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    rows = [
        {
            "id": "old-vector",
            "file_id": "file-1",
            "user_id": "user-1",
            "workspace_id": "workspace-1",
        },
        {
            "id": "old-text",
            "file_id": "file-1",
            "user_id": "user-1",
            "workspace_id": None,
        },
        {
            "id": "other-workspace",
            "file_id": "file-1",
            "user_id": "user-1",
            "workspace_id": "workspace-2",
        },
        {
            "id": "other-user",
            "file_id": "file-1",
            "user_id": "user-2",
            "workspace_id": None,
        },
        {
            "id": "other-file",
            "file_id": "file-2",
            "user_id": "user-1",
            "workspace_id": "workspace-1",
        },
    ]

    async def delete(table: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        assert table == "documents"
        assert filters["file_id"] == "file-1"
        assert "workspace_id" in filters
        deleted = [
            row
            for row in rows
            if all(
                row.get(key) == (value.get("is") if isinstance(value, dict) else value)
                for key, value in filters.items()
            )
        ]
        rows[:] = [row for row in rows if row not in deleted]
        return deleted

    monkeypatch.setattr(docs, "delete_many_trusted", delete)
    monkeypatch.setattr(
        docs,
        "insert_many",
        AsyncMock(side_effect=AssertionError("empty text must not be inserted")),
    )
    return rows


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "workspace_id,removed_id", [("workspace-1", "old-vector"), (None, "old-text")]
)
@pytest.mark.parametrize("text", ["", " \n\t "])
async def test_empty_replacement_clears_only_scoped_chunks(
    document_rows: list[dict[str, Any]],
    workspace_id: str | None,
    removed_id: str,
    text: str,
) -> None:
    expected = [row for row in document_rows if row["id"] != removed_id]
    for _ in range(2):
        result = await docs.store_extracted_text_chunks(
            file_id="file-1",
            user_id="user-1",
            workspace_id=workspace_id,
            text=text,
            replace_existing=True,
        )
        assert result == docs.StoredDocumentChunks(chunk_count=0, chunk_ids=[])
        assert document_rows == expected


@pytest.mark.asyncio
async def test_empty_append_preserves_existing_chunks(
    document_rows: list[dict[str, Any]],
) -> None:
    original = deepcopy(document_rows)
    await docs.store_extracted_text_chunks(file_id="file-1", user_id="user-1", text="")
    assert document_rows == original


def install_ingestion_fakes(
    monkeypatch: pytest.MonkeyPatch,
    workspace_id: str | None,
    extraction: ExtractionResult,
):
    file_row = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": workspace_id,
        "file_name": "changed.pdf",
        "storage_path": "supabase://omnix-files/changed.pdf",
        "metadata": {
            "text_chunk_count": 1,
            "embedded_chunk_count": 1,
            "embedded_chunk_ids": ["old-vector"],
            "vector_index_status": "ready",
        },
    }
    scope = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": workspace_id or {"is": None},
    }

    async def select(table, columns, filters):
        assert table == "files" and filters == scope
        return deepcopy(file_row)

    async def update(table, filters, payload):
        assert table == "files" and filters == scope
        file_row.update(deepcopy(payload))
        return deepcopy(file_row)

    monkeypatch.setattr(ingestion_jobs, "select_one_trusted", select)
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", update)
    monkeypatch.setattr(
        ingestion_jobs, "read_bytes_from_storage", AsyncMock(return_value=b"%PDF")
    )
    monkeypatch.setattr(
        ingestion_jobs, "document_likely_requires_ocr", lambda *args: False
    )
    monkeypatch.setattr(
        ingestion_jobs, "extract_document_with_diagnostics", lambda *args: extraction
    )
    monkeypatch.setattr(
        ingestion_jobs, "store_extracted_text_chunks", docs.store_extracted_text_chunks
    )
    monkeypatch.setattr(
        ingestion_jobs,
        "RAGIngestionPipeline",
        lambda *args: pytest.fail("unsearchable source must not embed"),
    )
    job = {
        "id": "job-1",
        "payload": {
            "file_id": "file-1",
            "user_id": "user-1",
            "workspace_id": workspace_id,
        },
    }
    return file_row, job


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "workspace_id,removed_id", [("workspace-1", "old-vector"), (None, "old-text")]
)
@pytest.mark.parametrize(
    "status,text",
    [
        ("extraction_failed", ""),
        ("ocr_required", ""),
        ("searchable", " \n "),
        ("extraction_failed", "unusable partial text"),
    ],
)
async def test_unsearchable_reprocessing_removes_stale_text_and_vectors(
    monkeypatch: pytest.MonkeyPatch,
    document_rows: list[dict[str, Any]],
    workspace_id: str | None,
    removed_id: str,
    status: str,
    text: str,
) -> None:
    expected = [row for row in document_rows if row["id"] != removed_id]
    extraction = ExtractionResult(
        text=text, diagnostics=ExtractionDiagnostics(extraction_status=status)
    )
    file_row, job = install_ingestion_fakes(monkeypatch, workspace_id, extraction)

    for _ in range(2):
        result = await ingestion_jobs.handle_ingest_file(job)
        assert document_rows == expected
        assert result["status"] == (
            "completed" if status == "ocr_required" else "failed"
        )
        assert result["processing_status"] == (
            "ocr_required" if status == "ocr_required" else "failed"
        )
        assert result["chunks"] == []
        assert file_row["metadata"]["text_chunk_count"] == 0
        assert file_row["metadata"]["embedded_chunk_count"] == 0
        assert file_row["metadata"]["embedded_chunk_ids"] == []
        assert file_row["metadata"]["vector_index_status"] == "unavailable"


@pytest.mark.asyncio
async def test_cleanup_failure_cannot_complete_ocr_required_job(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    extraction = ExtractionResult(
        text="", diagnostics=ExtractionDiagnostics(extraction_status="ocr_required")
    )
    file_row, job = install_ingestion_fakes(monkeypatch, "workspace-1", extraction)
    secret = "database-secret-document-content"
    monkeypatch.setattr(
        docs, "delete_many_trusted", AsyncMock(side_effect=RuntimeError(secret))
    )

    result = await ingestion_jobs.handle_ingest_file(job)

    assert result["status"] == "failed"
    assert file_row["processing_status"] == "failed"
    assert secret not in str(result) + str(file_row) + caplog.text
    assert "cleanup" in result["error"].lower()
