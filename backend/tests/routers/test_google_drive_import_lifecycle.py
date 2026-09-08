from __future__ import annotations

from typing import Any

import pytest

from app.routers import google_drive


@pytest.mark.asyncio
async def test_google_drive_import_discards_storage_when_file_registration_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    discarded_paths: list[str] = []

    async def fake_require_workspace_access(workspace_id: str, user_id: str) -> dict[str, Any]:
        assert (workspace_id, user_id) == ("workspace-1", "user-1")
        return {"workspace": {"id": workspace_id}, "role": "founder"}

    async def fake_get_token(user_id: str, workspace_id: str) -> dict[str, str]:
        assert (user_id, workspace_id) == ("user-1", "workspace-1")
        return {"access_token": "test-token"}

    async def fake_list_drive_files(*args: Any, **kwargs: Any) -> dict[str, list[dict[str, str]]]:
        return {"files": [{"id": "drive-file-1", "name": "plan.md", "mimeType": "text/markdown"}]}

    async def fake_download(*args: Any, **kwargs: Any) -> bytes:
        return b"# Plan"

    async def fake_save_bytes(*args: Any, **kwargs: Any) -> str:
        return "supabase://omnix-test/uploads/user-1/plan.md"

    async def fake_insert_one(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "files"
        raise google_drive.SupabaseServiceError("files insert failed")

    async def fake_discard(storage_path: str) -> None:
        discarded_paths.append(storage_path)

    async def enqueue_must_not_run(payload: dict[str, Any]) -> str:
        raise AssertionError("ingestion must not be queued without a file record")

    monkeypatch.setattr(google_drive, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(google_drive, "get_token_for_user", fake_get_token)
    monkeypatch.setattr(google_drive, "list_drive_files_for_user", fake_list_drive_files)
    monkeypatch.setattr(google_drive, "download_drive_file_bytes", fake_download)
    monkeypatch.setattr(google_drive, "save_bytes_to_user_upload", fake_save_bytes)
    monkeypatch.setattr(google_drive, "insert_one", fake_insert_one)
    monkeypatch.setattr("app.services.file_storage.discard_uncommitted_storage_object", fake_discard)
    monkeypatch.setattr(google_drive.job_queue, "enqueue_job", enqueue_must_not_run)

    with pytest.raises(google_drive.HTTPException) as error:
        await google_drive.import_file(
            workspace_id="workspace-1",
            file_id="drive-file-1",
            current_user={"sub": "user-1"},
        )

    assert error.value.status_code == 500
    assert discarded_paths == ["supabase://omnix-test/uploads/user-1/plan.md"]
