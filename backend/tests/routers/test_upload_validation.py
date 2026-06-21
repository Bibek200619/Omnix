from __future__ import annotations

import io
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.routers import upload
from app.services.workspace_service import WorkspaceAccess


def _client(current_user: dict[str, Any] | None = None, workspace_header: str | None = None) -> TestClient:
    app = FastAPI()
    if current_user is not None:
        app.dependency_overrides[get_current_user] = lambda: current_user
    app.include_router(upload.router)
    client = TestClient(app, raise_server_exceptions=False)
    if workspace_header:
        client.headers["X-Omnix-Workspace"] = workspace_header
    return client


# ---- Upload with .pdf extension but EXE (MZ) content ----


def test_pdf_with_exe_content_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_access = WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-1"}, role="member")

    async def allow_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return mock_access

    monkeypatch.setattr(upload, "require_workspace_access", allow_access)

    # Need to mock require_conversation_access to avoid import issues
    async def fake_conversation_access(*args: Any, **kwargs: Any) -> tuple:
        return {}, None

    # MZ = PE/EXE magic bytes + padding to meet minimum size
    exe_content = b"MZ" + b"\x00" * 100
    client = _client({"sub": "user-1", "role": "authenticated"}, workspace_header="ws-1")
    response = client.post(
        "/upload",
        files={"file": ("test.pdf", io.BytesIO(exe_content), "application/pdf")},
    )
    assert response.status_code == 400
    assert "does not match" in response.json()["detail"]


# ---- Upload with .pdf extension and valid PDF content ----


def test_pdf_with_valid_content_passes_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_access = WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-1"}, role="member")

    async def allow_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return mock_access

    monkeypatch.setattr(upload, "require_workspace_access", allow_access)

    async def fake_save(*args: Any, **kwargs: Any) -> str:
        return "/uploads/user-1/test.pdf"

    monkeypatch.setattr(upload, "save_bytes_to_user_upload", fake_save)

    async def fake_insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        return {"id": "file-1", **payload}

    monkeypatch.setattr(upload, "_insert_file_row", fake_insert)

    async def fake_enqueue(job: dict[str, Any]) -> str:
        return "job-1"

    monkeypatch.setattr(upload.job_queue, "enqueue_job", fake_enqueue)

    async def fake_update(**kwargs: Any) -> dict[str, Any]:
        return {}

    monkeypatch.setattr(upload, "_update_file_processing_state", fake_update)
    monkeypatch.setattr(upload, "log_workspace_activity", AsyncMock())

    # Valid PDF content
    pdf_content = b"%PDF-1.4 test content" + b"\x00" * 100
    client = _client({"sub": "user-1", "role": "authenticated"}, workspace_header="ws-1")
    response = client.post(
        "/upload",
        files={"file": ("test.pdf", io.BytesIO(pdf_content), "application/pdf")},
    )
    # Should pass validation (may fail on downstream mocks, but not with 400 content mismatch)
    assert response.status_code != 400 or "does not match" not in response.json().get("detail", "")


# ---- Upload with .docx extension and valid DOCX (PK) content ----


def test_docx_with_valid_content_passes_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_access = WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-1"}, role="member")

    async def allow_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return mock_access

    monkeypatch.setattr(upload, "require_workspace_access", allow_access)

    async def fake_save(*args: Any, **kwargs: Any) -> str:
        return "/uploads/user-1/test.docx"

    monkeypatch.setattr(upload, "save_bytes_to_user_upload", fake_save)

    async def fake_insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        return {"id": "file-1", **payload}

    monkeypatch.setattr(upload, "_insert_file_row", fake_insert)

    async def fake_enqueue(job: dict[str, Any]) -> str:
        return "job-1"

    monkeypatch.setattr(upload.job_queue, "enqueue_job", fake_enqueue)

    async def fake_update(**kwargs: Any) -> dict[str, Any]:
        return {}

    monkeypatch.setattr(upload, "_update_file_processing_state", fake_update)
    monkeypatch.setattr(upload, "log_workspace_activity", AsyncMock())

    # PK = ZIP/DOCX magic bytes
    docx_content = b"PK\x03\x04" + b"\x00" * 100
    client = _client({"sub": "user-1", "role": "authenticated"}, workspace_header="ws-1")
    response = client.post(
        "/upload",
        files={"file": ("test.docx", io.BytesIO(docx_content), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert response.status_code != 400 or "does not match" not in response.json().get("detail", "")


# ---- Upload with .pdf extension but ELF binary content ----


def test_pdf_with_elf_content_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_access = WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-1"}, role="member")

    async def allow_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return mock_access

    monkeypatch.setattr(upload, "require_workspace_access", allow_access)

    elf_content = b"\x7fELF" + b"\x00" * 100
    client = _client({"sub": "user-1", "role": "authenticated"}, workspace_header="ws-1")
    response = client.post(
        "/upload",
        files={"file": ("malicious.pdf", io.BytesIO(elf_content), "application/pdf")},
    )
    assert response.status_code == 400
    assert "does not match" in response.json()["detail"]
