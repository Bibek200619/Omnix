from __future__ import annotations

from io import BytesIO
from typing import Any

import pytest
from starlette.datastructures import Headers, UploadFile
from starlette.requests import Request

from app.routers import upload


def _workspace_request(workspace_id: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/upload",
            "headers": [(b"x-omnix-workspace", workspace_id.encode("utf-8"))],
        }
    )


def _upload_file() -> UploadFile:
    return UploadFile(
        BytesIO(b"# Release note\n\nThe upload should be processed later."),
        filename="release-note.md",
        headers=Headers({"content-type": "text/markdown"}),
    )


@pytest.mark.asyncio
async def test_upload_returns_queued_state_without_document_extraction(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    inserted: dict[str, Any] = {}
    updates: list[dict[str, Any]] = []
    jobs: list[dict[str, Any]] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        assert workspace_id == "workspace-1"
        assert user_id == "user-1"
        return {"workspace": {"id": workspace_id}, "role": "founder"}

    async def fake_insert_one(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "files"
        inserted.update(payload)
        return {"id": "file-1", "created_at": "2026-06-20T00:00:00+00:00", **payload}

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "files"
        assert filters == {"id": "file-1", "user_id": "user-1"}
        updates.append(payload)
        return {"id": "file-1", "created_at": "2026-06-20T00:00:00+00:00", **inserted, **payload}

    async def fake_enqueue_job(payload: dict[str, Any]) -> str:
        jobs.append(payload)
        return "11111111-1111-1111-1111-111111111111"

    async def fake_log_activity(**kwargs: Any) -> None:
        return None

    def extraction_must_not_run(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("upload request path must not extract document text")

    monkeypatch.setattr(upload, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(upload, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(upload, "insert_one", fake_insert_one)
    monkeypatch.setattr(upload, "update_one", fake_update_one)
    monkeypatch.setattr(upload.job_queue, "enqueue_job", fake_enqueue_job)
    monkeypatch.setattr(upload, "log_workspace_activity", fake_log_activity)
    monkeypatch.setattr("app.services.document_intelligence_service.extract_document_with_diagnostics", extraction_must_not_run)

    result = await upload.upload_file(
        _workspace_request("workspace-1"),
        file=_upload_file(),
        conversation_id=None,
        current_user={"sub": "user-1"},
    )

    assert inserted["processing_status"] == "uploaded"
    assert result["processing_status"] == "queued"
    assert result["processing_job_id"] == "11111111-1111-1111-1111-111111111111"
    assert result["metadata"]["processing_status"] == "queued"
    assert jobs == [
        {
            "type": "ingest_file",
            "file_id": "file-1",
            "user_id": "user-1",
            "workspace_id": "workspace-1",
            "_queue": "omnix:jobs",
        }
    ]


@pytest.mark.asyncio
async def test_upload_marks_processing_failed_when_enqueue_cannot_persist_job(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    inserted: dict[str, Any] = {}
    updates: list[dict[str, Any]] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str):
        return {"workspace": {"id": workspace_id}, "role": "founder"}

    async def fake_insert_one(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "files"
        inserted.update(payload)
        return {"id": "file-1", "created_at": "2026-06-20T00:00:00+00:00", **payload}

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "files"
        updates.append(payload)
        return {"id": "file-1", "created_at": "2026-06-20T00:00:00+00:00", **inserted, **payload}

    async def fake_enqueue_job(payload: dict[str, Any]) -> str:
        raise upload.job_queue.JobEnqueueError("Job could not be persisted.", job_id="job-failed", persisted=False)

    async def fake_log_activity(**kwargs: Any) -> None:
        return None

    monkeypatch.setattr(upload, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(upload, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(upload, "insert_one", fake_insert_one)
    monkeypatch.setattr(upload, "update_one", fake_update_one)
    monkeypatch.setattr(upload.job_queue, "enqueue_job", fake_enqueue_job)
    monkeypatch.setattr(upload, "log_workspace_activity", fake_log_activity)

    result = await upload.upload_file(
        _workspace_request("workspace-1"),
        file=_upload_file(),
        conversation_id=None,
        current_user={"sub": "user-1"},
    )

    assert result["processing_status"] == "failed"
    assert "could not be queued" in result["processing_error"]
    assert result["metadata"]["processing_status"] == "failed"
    assert "could not be queued" in result["metadata"]["processing_error"]
    assert updates[-1]["processing_status"] == "failed"
