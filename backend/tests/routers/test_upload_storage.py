from __future__ import annotations

import hashlib
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import files, upload
from app.services.supabase_service import SupabaseServiceError


class _FakeUploadFile:
    def __init__(self, filename: str, content_type: str, data: bytes) -> None:
        self.filename = filename
        self.content_type = content_type
        self._data = data

    async def read(self) -> bytes:
        return self._data


@pytest.mark.asyncio
async def test_store_upload_bytes_defaults_to_supabase(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_upload(storage_path: str, data: bytes, content_type: str | None = None) -> None:
        calls.append({"storage_path": storage_path, "data": data, "content_type": content_type})

    monkeypatch.delenv("OMNIX_STORAGE_BACKEND", raising=False)
    monkeypatch.setattr(upload, "upload_bytes_to_supabase_storage", fake_upload, raising=False)

    stored = await upload._store_upload_bytes(
        user_id="user-1",
        filename="report.pdf",
        data=b"%PDF-1.7",
        file_type="application/pdf",
    )

    assert stored.storage_backend == "supabase"
    assert stored.storage_path.startswith("user-1/")
    assert stored.storage_path.endswith("_report.pdf")
    assert calls == [
        {
            "storage_path": stored.storage_path,
            "data": b"%PDF-1.7",
            "content_type": "application/pdf",
        }
    ]


@pytest.mark.asyncio
async def test_store_upload_bytes_keeps_local_fallback(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OMNIX_STORAGE_BACKEND", "local")
    monkeypatch.setattr(upload, "UPLOAD_DIR", str(tmp_path))

    stored = await upload._store_upload_bytes(
        user_id="user-1",
        filename="notes.txt",
        data=b"hello",
        file_type="text/plain",
    )

    assert stored.storage_backend == "local"
    assert Path(stored.storage_path).read_bytes() == b"hello"


@pytest.mark.asyncio
async def test_insert_file_row_retries_without_storage_backend_for_legacy_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        calls.append(dict(payload))
        if "storage_backend" in payload:
            exc = SupabaseServiceError("Internal server error")
            exc.__cause__ = Exception("column storage_backend does not exist")
            raise exc
        return {"id": "file-1", **payload}

    monkeypatch.setattr(upload, "insert_one", fake_insert)

    row = await upload._insert_file_row(
        {
            "file_name": "report.pdf",
            "storage_path": "user-1/report.pdf",
            "storage_backend": "supabase",
        },
        "user-1",
    )

    assert row["id"] == "file-1"
    assert "storage_backend" in calls[0]
    assert "storage_backend" not in calls[1]


@pytest.mark.asyncio
async def test_download_supabase_file_redirects_to_signed_url(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_file_access(file_id: str, user_id: str):
        assert file_id == "file-1"
        assert user_id == "user-1"
        return (
            {
                "id": "file-1",
                "user_id": "user-1",
                "file_name": "report.pdf",
                "file_type": "application/pdf",
                "storage_path": "user-1/report.pdf",
                "storage_backend": "supabase",
            },
            None,
        )

    async def fake_signed_url(storage_path: str, expires_in: int = 3600) -> str:
        assert storage_path == "user-1/report.pdf"
        return "https://storage.example.com/signed/report.pdf"

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "create_supabase_signed_url", fake_signed_url, raising=False)

    response = await files.download_file("file-1", {"sub": "user-1"})

    assert response.status_code == 307
    assert response.headers["location"] == "https://storage.example.com/signed/report.pdf"


def test_upload_rejects_pdf_with_non_pdf_bytes() -> None:
    with pytest.raises(HTTPException) as exc_info:
        upload._validate_upload_content(
            filename="malware.pdf",
            file_type="application/pdf",
            data=b"not actually a pdf",
        )

    assert exc_info.value.status_code == 400
    assert "content does not match" in exc_info.value.detail


def test_upload_accepts_valid_pdf_magic_bytes() -> None:
    upload._validate_upload_content(
        filename="report.pdf",
        file_type="application/pdf",
        data=b"%PDF-1.7\nbody",
    )


def test_upload_rejects_docx_without_zip_header() -> None:
    with pytest.raises(HTTPException):
        upload._validate_upload_content(
            filename="notes.docx",
            file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            data=b"plain text",
        )


def test_upload_rejects_binary_text_file() -> None:
    with pytest.raises(HTTPException):
        upload._validate_upload_content(
            filename="notes.txt",
            file_type="text/plain",
            data=b"\xff\xfe\x00\x00",
        )


@pytest.mark.asyncio
async def test_upload_deduplicates_existing_workspace_file_before_ingestion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = b"Launch notes with enough text to extract and chunk."
    expected_hash = hashlib.sha256(data).hexdigest()
    existing_file = {
        "id": "file-existing",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "file_name": "notes.txt",
        "file_type": "text/plain",
        "size_bytes": len(data),
        "content_hash": expected_hash,
    }

    async def fake_require_workspace_access(workspace_id: str, user_id: str) -> None:
        assert (workspace_id, user_id) == ("workspace-1", "user-1")

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]):
        assert table == "files"
        assert filters == {"content_hash": expected_hash, "workspace_id": "workspace-1"}
        return existing_file

    async def fail_store_upload_bytes(**kwargs: Any):
        raise AssertionError("duplicate upload must not store bytes")

    async def fail_insert_file_row(*args: Any, **kwargs: Any):
        raise AssertionError("duplicate upload must not insert a file row")

    async def fail_store_chunks(*args: Any, **kwargs: Any):
        raise AssertionError("duplicate upload must not create chunks")

    async def fail_log_activity(*args: Any, **kwargs: Any):
        raise AssertionError("duplicate upload must not log a new upload")

    monkeypatch.setattr(upload, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(upload, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(upload, "_store_upload_bytes", fail_store_upload_bytes)
    monkeypatch.setattr(upload, "_insert_file_row", fail_insert_file_row)
    monkeypatch.setattr(upload, "store_extracted_text_chunks", fail_store_chunks, raising=False)
    monkeypatch.setattr(upload, "log_workspace_activity", fail_log_activity)

    result = await upload.upload_file(
        request=SimpleNamespace(headers={"X-Omnix-Workspace": "workspace-1"}),
        file=_FakeUploadFile("notes.txt", "text/plain", data),
        conversation_id=None,
        current_user={"sub": "user-1"},
    )

    assert result["status"] == "deduplicated"
    assert result["file_id"] == "file-existing"
    assert result["content_hash"] == expected_hash


@pytest.mark.asyncio
async def test_upload_returns_processing_without_inline_extraction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = b"%PDF-1.7\nscanned pdf bytes"
    inserted_rows: list[dict[str, Any]] = []
    enqueued_jobs: list[dict[str, Any]] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str) -> None:
        assert (workspace_id, user_id) == ("workspace-1", "user-1")

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]):
        return None

    async def fake_store_upload_bytes(**kwargs: Any) -> upload.StoredUpload:
        return upload.StoredUpload(storage_path="user-1/scanned.pdf", storage_backend="supabase")

    async def fake_insert_file_row(payload: dict[str, Any], user_id: str) -> dict[str, Any]:
        row = {"id": "file-processing", "user_id": user_id, **payload}
        inserted_rows.append(row)
        return row

    async def fake_enqueue_job(payload: dict[str, Any]) -> str:
        enqueued_jobs.append(payload)
        return "job-1"

    def fail_extract(*args: Any, **kwargs: Any):
        raise AssertionError("upload must not run extraction inline")

    async def fail_update(*args: Any, **kwargs: Any):
        raise AssertionError("upload must not update extraction diagnostics inline")

    async def fail_store_chunks(*args: Any, **kwargs: Any):
        raise AssertionError("upload must not create chunks inline")

    monkeypatch.setattr(upload, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(upload, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(upload, "_store_upload_bytes", fake_store_upload_bytes)
    monkeypatch.setattr(upload, "_insert_file_row", fake_insert_file_row)
    monkeypatch.setattr(upload, "extract_document_with_diagnostics", fail_extract, raising=False)
    monkeypatch.setattr(upload, "update_one", fail_update, raising=False)
    monkeypatch.setattr(upload, "store_extracted_text_chunks", fail_store_chunks, raising=False)

    import app.jobs.queue as queue

    monkeypatch.setattr(queue, "enqueue_job", fake_enqueue_job)

    started = time.perf_counter()
    result = await upload.upload_file(
        request=SimpleNamespace(headers={"X-Omnix-Workspace": "workspace-1"}),
        file=_FakeUploadFile("scanned.pdf", "application/pdf", data),
        conversation_id=None,
        current_user={"sub": "user-1"},
    )
    elapsed = time.perf_counter() - started

    assert elapsed < 1.0
    assert result["id"] == "file-processing"
    assert result["extraction_status"] == "processing"
    assert inserted_rows[0]["metadata"]["extraction_status"] == "processing"
    assert enqueued_jobs == [
        {
            "type": "ingest_file",
            "file_id": "file-processing",
            "user_id": "user-1",
            "workspace_id": "workspace-1",
        }
    ]
