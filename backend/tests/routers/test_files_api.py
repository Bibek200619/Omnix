from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import files
from app.services.file_storage import sanitize_filename


def _files_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    app.dependency_overrides[files.get_current_user] = lambda: current_user or {
        "sub": "user-1",
        "email": "alex@example.com",
    }
    app.include_router(files.router)
    return TestClient(app)


def test_create_file_metadata_rejects_client_storage_path() -> None:
    client = _files_client()

    response = client.post(
        "/files",
        json={
            "file_name": "notes.txt",
            "file_type": "text/plain",
            "size_bytes": 12,
            "storage_path": "/etc/passwd",
        },
    )

    assert response.status_code == 422


def test_create_file_metadata_does_not_persist_storage_path(monkeypatch) -> None:
    captured_payload: dict[str, Any] = {}

    async def fake_insert_one(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        captured_payload.update(payload)
        return {
            "id": "file-1",
            "user_id": payload["user_id"],
            "file_name": payload["file_name"],
            "file_type": payload.get("file_type"),
            "size_bytes": payload.get("size_bytes"),
            "storage_path": None,
            "metadata": payload.get("metadata"),
        }

    monkeypatch.setattr(files, "insert_one", fake_insert_one)
    client = _files_client()

    response = client.post(
        "/files",
        json={
            "file_name": "notes.txt",
            "file_type": "text/plain",
            "size_bytes": 12,
        },
    )

    assert response.status_code == 201
    assert captured_payload["user_id"] == "user-1"
    assert "storage_path" not in captured_payload


def test_download_refuses_storage_path_outside_upload_root(monkeypatch) -> None:
    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": filters["id"],
            "user_id": "user-1",
            "file_name": "passwd.txt",
            "file_type": "text/plain",
            "storage_path": "/etc/passwd",
        }

    monkeypatch.setattr(files, "select_one_trusted", fake_select_one_trusted)
    client = _files_client()

    response = client.get("/files/file-1/download")

    assert response.status_code == 404
    assert response.json()["detail"] == "File content not found on server."


def test_download_allows_managed_upload_path(monkeypatch, tmp_path) -> None:
    upload_root = tmp_path / "uploads"
    stored_file = upload_root / "user-1" / "stored_notes.txt"
    stored_file.parent.mkdir(parents=True)
    stored_file.write_text("safe notes", encoding="utf-8")
    monkeypatch.setenv("OMNIX_UPLOAD_DIR", str(upload_root))

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": filters["id"],
            "user_id": "user-1",
            "file_name": "notes.txt",
            "file_type": "text/plain",
            "storage_path": str(stored_file),
        }

    monkeypatch.setattr(files, "select_one_trusted", fake_select_one_trusted)
    client = _files_client()

    response = client.get("/files/file-1/download")

    assert response.status_code == 200
    assert response.content == b"safe notes"


def test_sanitize_filename_uses_allowlisted_storage_name() -> None:
    assert sanitize_filename("../../\x00\n report<script>.pdf") == "report_script_.pdf"
    assert sanitize_filename("...") == "unnamed"
