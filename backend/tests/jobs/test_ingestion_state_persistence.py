from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.jobs import ingestion_jobs
from app.services.document_context_service import StoredDocumentChunks
from app.services.document_intelligence_service import (
    ExtractionDiagnostics,
    ExtractionResult,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_id", [None, "workspace-1"])
@pytest.mark.parametrize("outcome", ["updated", "no_row", "error"])
async def test_processing_state_requires_a_persisted_scoped_row(
    monkeypatch: pytest.MonkeyPatch, workspace_id: str | None, outcome: str
) -> None:
    persisted = {"id": "file-1", "processing_status": "embedding"}
    update = AsyncMock(return_value=persisted if outcome == "updated" else None)
    if outcome == "error":
        update.side_effect = RuntimeError("private database error")
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", update)

    call = ingestion_jobs._update_file_processing_state(
        "file-1",
        {"metadata": {"retained": True}, "processing_job_id": "job-1"},
        user_id="user-1",
        workspace_id=workspace_id,
        processing_status="embedding",
        metadata_updates={"vector_index_status": "pending"},
    )
    if outcome == "updated":
        assert await call is persisted
    else:
        with pytest.raises(RuntimeError, match="Unable to save file processing state"):
            await call

    update.assert_awaited_once()
    table, filters, payload = update.call_args.args
    assert table == "files"
    assert filters == {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": workspace_id if workspace_id else {"is": None},
    }
    assert payload["processing_status"] == "embedding"
    assert payload["metadata"] == {
        "retained": True,
        "vector_index_status": "pending",
        "processing_status": "embedding",
        "processing_job_id": "job-1",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("failed_stage", ["extracting", "searchable"])
@pytest.mark.parametrize("outcome", ["no_row", "error"])
async def test_ingestion_state_failure_stops_completion_and_recovers_on_retry(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    failed_stage: str,
    outcome: str,
) -> None:
    file_row: dict[str, Any] = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "file_name": "note.md",
        "file_type": "text/markdown",
        "storage_path": "test-storage-path",
        "metadata": {},
    }
    job = {"payload": {key: file_row[key] for key in ("user_id", "workspace_id")}}
    job["payload"]["file_id"] = "file-1"
    fail_write = True
    payloads: list[dict[str, Any]] = []
    secret_detail = "private database host and document contents"

    async def update(table, filters, payload):
        assert table == "files"
        assert filters == {
            "id": "file-1",
            "user_id": "user-1",
            "workspace_id": "workspace-1",
        }
        payloads.append(payload)
        if fail_write and payload.get("processing_status") == failed_stage:
            if outcome == "error":
                raise RuntimeError(secret_detail)
            return None
        file_row.update(payload)
        return dict(file_row)

    monkeypatch.setattr(
        ingestion_jobs, "select_one_trusted", AsyncMock(return_value=file_row)
    )
    monkeypatch.setattr(ingestion_jobs, "update_one_trusted", update)
    read = AsyncMock(return_value=b"A note")
    store = AsyncMock(return_value=StoredDocumentChunks(1, ["text-1"], False))
    ingest = AsyncMock(return_value=(1, ["vector-1"]))
    monkeypatch.setattr(ingestion_jobs, "read_bytes_from_storage", read)
    monkeypatch.setattr(
        ingestion_jobs, "document_likely_requires_ocr", lambda *args: False
    )
    monkeypatch.setattr(
        ingestion_jobs,
        "extract_document_with_diagnostics",
        lambda *args: ExtractionResult(
            text="A note",
            diagnostics=ExtractionDiagnostics(
                extractor_used="text", extraction_status="searchable"
            ),
        ),
    )
    monkeypatch.setattr(ingestion_jobs, "store_extracted_text_chunks", store)
    monkeypatch.setattr(ingestion_jobs, "get_vector_store", lambda: object())
    monkeypatch.setattr("app.embeddings.provider.warm_up_default_provider", AsyncMock())

    class Pipeline:
        def __init__(self, vector_store):
            self.ingest_text = ingest

    monkeypatch.setattr(ingestion_jobs, "RAGIngestionPipeline", Pipeline)

    first = await ingestion_jobs.handle_ingest_file(job)

    assert first["status"] == "failed"
    assert "Unable to save file processing state" in first["error"]
    assert file_row["processing_status"] == "failed"
    assert all("processing_status" in payload for payload in payloads)
    assert secret_detail not in str(first) + str(file_row) + caplog.text
    if failed_stage == "extracting":
        read.assert_not_awaited()
        store.assert_not_awaited()
        ingest.assert_not_awaited()

    fail_write = False
    second = await ingestion_jobs.handle_ingest_file(job)

    assert second == {
        "status": "completed",
        "processing_status": "searchable",
        "chunks": ["vector-1"],
    }
    assert (
        file_row["processing_status"]
        == file_row["metadata"]["processing_status"]
        == "searchable"
    )
    assert file_row["processing_error"] is None
    assert "processing_error" not in file_row["metadata"]
    assert all(call.kwargs["replace_existing"] for call in store.await_args_list)
    assert all(call.kwargs["replace_existing"] for call in ingest.await_args_list)
