from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routers import files
from app.services.file_storage import sanitize_filename
from app.services.workspace_common import WorkspaceAccess


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


def test_workspace_file_hydrates_storage_path_only_after_authorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, object]] = []
    hydrated = {
        "id": "file-1",
        "user_id": "owner-1",
        "workspace_id": "workspace-1",
        "file_name": "private.pdf",
        "file_type": "application/pdf",
        "storage_path": "supabase://omnix-test/uploads/owner-1/private.pdf",
    }

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "files"
        events.append(("select", (columns, filters)))
        if columns == files.FILE_LOCATOR_COLUMNS:
            return {
                "id": "file-1",
                "user_id": "owner-1",
                "workspace_id": "workspace-1",
            }
        assert columns == files.FILE_COLUMNS
        return hydrated

    async def fake_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        events.append(("authorize", (workspace_id, user_id)))
        return WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": "owner-1",
                "workspace_type": "workspace",
            },
            role="member",
        )

    async def fake_read(storage_path: str) -> bytes:
        events.append(("read", storage_path))
        return b"%PDF-1.4"

    monkeypatch.setattr(files, "select_one_trusted", fake_select)
    monkeypatch.setattr(files, "require_workspace_access", fake_access)
    monkeypatch.setattr(files, "read_bytes_from_storage", fake_read)
    client = _files_client({"sub": "member-1", "role": "authenticated"})

    response = client.get("/files/file-1/download")

    assert response.status_code == 200
    assert events == [
        (
            "select",
            (files.FILE_LOCATOR_COLUMNS, {"id": "file-1"}),
        ),
        ("authorize", ("workspace-1", "member-1")),
        (
            "select",
            (
                files.FILE_COLUMNS,
                {"id": "file-1", "workspace_id": "workspace-1"},
            ),
        ),
        (
            "read",
            "supabase://omnix-test/uploads/owner-1/private.pdf",
        ),
    ]


def test_denied_workspace_file_does_not_hydrate_storage_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    selections: list[tuple[str, dict[str, Any]]] = []

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "files"
        selections.append((columns, filters))
        if columns != files.FILE_LOCATOR_COLUMNS:
            raise AssertionError("File storage metadata must follow authorization.")
        return {
            "id": "file-1",
            "user_id": "owner-1",
            "workspace_id": "workspace-1",
        }

    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=403, detail="Workspace access denied.")

    async def fail_read(storage_path: str) -> bytes:
        raise AssertionError("Storage must not be read without workspace access.")

    monkeypatch.setattr(files, "select_one_trusted", fake_select)
    monkeypatch.setattr(files, "require_workspace_access", deny_access)
    monkeypatch.setattr(files, "read_bytes_from_storage", fail_read)
    client = _files_client({"sub": "outsider-1", "role": "authenticated"})

    response = client.get("/files/file-1/download")

    assert response.status_code == 404
    assert response.json() == {"detail": "File not found."}
    assert selections == [
        (files.FILE_LOCATOR_COLUMNS, {"id": "file-1"}),
    ]


def test_personal_file_list_excludes_workspace_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def no_workspace(*args: Any, **kwargs: Any) -> None:
        return None

    async def fake_select_all(
        table: str,
        columns: str,
        filters: dict[str, Any],
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        captured.update(
            {
                "table": table,
                "columns": columns,
                "filters": filters,
                "kwargs": kwargs,
            }
        )
        return []

    monkeypatch.setattr(files, "_resolve_effective_workspace_id", no_workspace)
    monkeypatch.setattr(files, "select_all", fake_select_all)
    client = _files_client({"sub": "user-1", "role": "authenticated"})

    response = client.get("/files")

    assert response.status_code == 200
    assert captured["table"] == "files"
    assert captured["filters"] == {
        "user_id": "user-1",
        "workspace_id": {"is": None},
    }


def test_sanitize_filename_uses_allowlisted_storage_name() -> None:
    assert sanitize_filename("../../\x00\n report<script>.pdf") == "report_script_.pdf"
    assert sanitize_filename("...") == "unnamed"
