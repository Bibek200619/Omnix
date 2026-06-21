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

    # Create a mock Path that raises FileNotFoundError on unlink
    mock_path = MagicMock(spec=Path)
    mock_path.exists.return_value = False
    mock_path.unlink.side_effect = FileNotFoundError("No such file")

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "delete_many_trusted", fake_delete_many)
    monkeypatch.setattr(files, "resolve_managed_storage_path", lambda p: mock_path)

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

    mock_path = MagicMock(spec=Path)
    mock_path.unlink.side_effect = FileNotFoundError("No such file")

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "delete_many_trusted", fake_delete_many)
    monkeypatch.setattr(files, "resolve_managed_storage_path", lambda p: mock_path)

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

    mock_path = MagicMock(spec=Path)
    mock_path.unlink.return_value = None  # Successful unlink

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "delete_many_trusted", fake_delete_many)
    monkeypatch.setattr(files, "resolve_managed_storage_path", lambda p: mock_path)

    client = _files_client()
    response = client.delete("/files/file-2")
    assert response.status_code == 204
