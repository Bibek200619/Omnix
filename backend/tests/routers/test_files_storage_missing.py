from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import files
from app.services.workspace_service import WorkspaceAccess


def _files_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    app.dependency_overrides[files.get_current_user] = lambda: current_user or {
        "sub": "user-1",
        "email": "alex@example.com",
    }
    app.include_router(files.router)
    return TestClient(app, raise_server_exceptions=False)


def test_delete_file_with_missing_storage_returns_storage_missing_true(monkeypatch: pytest.MonkeyPatch) -> None:
    """When the physical file is already missing, delete should return 200 with storage_missing: true."""
    file_row = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": None,
        "storage_path": "/uploads/user-1/deleted.pdf",
        "file_name": "deleted.pdf",
    }

    async def fake_require_file_access(file_id: str, user_id: str) -> tuple:
        return file_row, None

    async def fake_delete_many(*args: Any, **kwargs: Any) -> None:
        pass

    async def fake_delete_storage_object(storage_path: str) -> bool:
        assert storage_path == "/uploads/user-1/deleted.pdf"
        return False

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "delete_many_trusted", fake_delete_many)
    monkeypatch.setattr(files, "delete_storage_object", fake_delete_storage_object)

    client = _files_client()
    response = client.delete("/files/file-1")
    assert response.status_code == 200
    data = response.json()
    assert data["storage_missing"] is True


def test_delete_file_with_missing_storage_logs_warning(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When the physical file is missing, a WARNING log should be emitted with file_id and path."""
    file_row = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": None,
        "storage_path": "/uploads/user-1/deleted.pdf",
        "file_name": "deleted.pdf",
    }

    async def fake_require_file_access(file_id: str, user_id: str) -> tuple:
        return file_row, None

    async def fake_delete_many(*args: Any, **kwargs: Any) -> None:
        pass

    async def fake_delete_storage_object(storage_path: str) -> bool:
        assert storage_path == "/uploads/user-1/deleted.pdf"
        return False

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "delete_many_trusted", fake_delete_many)
    monkeypatch.setattr(files, "delete_storage_object", fake_delete_storage_object)

    client = _files_client()
    with caplog.at_level(logging.WARNING, logger="app.routers.files"):
        client.delete("/files/file-1")

    assert any("file-1" in record.message and "deleted.pdf" in record.message for record in caplog.records), (
        f"Expected warning log with file_id and path, got: {[r.message for r in caplog.records]}"
    )


def test_delete_file_with_existing_storage_returns_204(monkeypatch: pytest.MonkeyPatch) -> None:
    """Normal deletion (file exists on disk) should return 204."""
    file_row = {
        "id": "file-2",
        "user_id": "user-1",
        "workspace_id": None,
        "storage_path": "/uploads/user-1/exists.pdf",
        "file_name": "exists.pdf",
    }

    async def fake_require_file_access(file_id: str, user_id: str) -> tuple:
        return file_row, None

    async def fake_delete_many(*args: Any, **kwargs: Any) -> None:
        pass

    async def fake_delete_storage_object(storage_path: str) -> bool:
        assert storage_path == "/uploads/user-1/exists.pdf"
        return True

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "delete_many_trusted", fake_delete_many)
    monkeypatch.setattr(files, "delete_storage_object", fake_delete_storage_object)

    client = _files_client()
    response = client.delete("/files/file-2")
    assert response.status_code == 204


def test_download_file_reads_from_storage_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    file_row = {
        "id": "file-3",
        "user_id": "user-1",
        "workspace_id": None,
        "storage_path": "supabase://omnix-test/uploads/user-1/report.pdf",
        "file_name": "report.pdf",
        "file_type": "application/pdf",
    }

    async def fake_require_file_access(file_id: str, user_id: str) -> tuple:
        return file_row, None

    async def fake_read_bytes_from_storage(storage_path: str) -> bytes:
        assert storage_path == "supabase://omnix-test/uploads/user-1/report.pdf"
        return b"%PDF-1.4"

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "read_bytes_from_storage", fake_read_bytes_from_storage)

    client = _files_client()
    response = client.get("/files/file-3/download")

    assert response.status_code == 200
    assert response.content == b"%PDF-1.4"
    assert response.headers["content-type"] == "application/pdf"
    assert "filename*=UTF-8''report.pdf" in response.headers["content-disposition"]
