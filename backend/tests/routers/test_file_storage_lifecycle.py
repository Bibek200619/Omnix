from __future__ import annotations

import json
from typing import Any

import pytest

from app.routers import files


@pytest.mark.asyncio
async def test_delete_file_removes_storage_chunks_then_file_and_logs_workspace_activity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[Any, ...]] = []
    file_row = {
        "id": "file-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "storage_path": "supabase://omnix-test/uploads/user-1/report.pdf",
        "file_name": "report.pdf",
    }

    async def fake_require_file_access(file_id: str, user_id: str) -> tuple[dict[str, Any], object]:
        return file_row, object()

    async def fake_delete_storage_object(storage_path: str) -> bool:
        events.append(("storage", storage_path))
        return True

    async def fake_delete_many(table: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        events.append(("delete", table, filters))
        return []

    async def fake_log_activity(**kwargs: Any) -> None:
        events.append(("activity", kwargs["workspace_id"], kwargs["metadata"]))

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "can_manage_workspace_resource", lambda *args: True)
    monkeypatch.setattr(files, "delete_storage_object", fake_delete_storage_object)
    monkeypatch.setattr(files, "delete_many_trusted", fake_delete_many)
    monkeypatch.setattr(files, "log_workspace_activity", fake_log_activity)

    response = await files.delete_file("file-1", current_user={"sub": "user-1"})

    assert response.status_code == 204
    assert events == [
        ("storage", "supabase://omnix-test/uploads/user-1/report.pdf"),
        ("delete", "documents", {"file_id": "file-1", "workspace_id": "workspace-1"}),
        ("delete", "files", {"id": "file-1"}),
        ("activity", "workspace-1", {"file_id": "file-1"}),
    ]


@pytest.mark.asyncio
async def test_delete_file_cleans_logical_records_when_storage_is_already_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[Any, ...]] = []
    file_row = {
        "id": "file-2",
        "user_id": "user-1",
        "workspace_id": None,
        "storage_path": "supabase://omnix-test/uploads/user-1/missing.pdf",
        "file_name": "missing.pdf",
    }

    async def fake_require_file_access(file_id: str, user_id: str) -> tuple[dict[str, Any], None]:
        return file_row, None

    async def fake_delete_storage_object(storage_path: str) -> bool:
        events.append(("storage", storage_path))
        return False

    async def fake_delete_many(table: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        events.append(("delete", table, filters))
        return []

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "delete_storage_object", fake_delete_storage_object)
    monkeypatch.setattr(files, "delete_many_trusted", fake_delete_many)

    response = await files.delete_file("file-2", current_user={"sub": "user-1"})

    assert response.status_code == 200
    assert json.loads(response.body) == {"storage_missing": True}
    assert events == [
        ("storage", "supabase://omnix-test/uploads/user-1/missing.pdf"),
        ("delete", "documents", {"file_id": "file-2", "user_id": "user-1", "workspace_id": {"is": None}}),
        ("delete", "files", {"id": "file-2"}),
    ]


@pytest.mark.asyncio
async def test_delete_file_keeps_logical_records_when_storage_delete_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    file_row = {
        "id": "file-3",
        "user_id": "user-1",
        "workspace_id": None,
        "storage_path": "supabase://omnix-test/uploads/user-1/report.pdf",
        "file_name": "report.pdf",
    }

    async def fake_require_file_access(file_id: str, user_id: str) -> tuple[dict[str, Any], None]:
        return file_row, None

    async def failing_delete_storage_object(storage_path: str) -> bool:
        events.append("storage")
        raise files.StorageError("storage unavailable")

    async def delete_must_not_run(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        events.append("database")
        raise AssertionError("logical records must remain retryable")

    monkeypatch.setattr(files, "_require_file_access", fake_require_file_access)
    monkeypatch.setattr(files, "delete_storage_object", failing_delete_storage_object)
    monkeypatch.setattr(files, "delete_many_trusted", delete_must_not_run)

    with pytest.raises(files.HTTPException) as error:
        await files.delete_file("file-3", current_user={"sub": "user-1"})

    assert error.value.status_code == 500
    assert events == ["storage"]
