from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from app.jobs import file_lifecycle_jobs as lifecycle
from app.jobs import worker
from app.runtime.manager import RuntimeManager


@pytest.mark.asyncio
async def test_cleanup_rechecks_active_references_before_storage_delete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    updates: list[tuple[str, dict[str, Any], dict[str, Any]]] = []

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        if table == "file_versions" and filters == {"id": "version-1"}:
            return {
                "id": "version-1",
                "storage_path": "supabase://files/uploads/user/object.pdf",
                "storage_backend": "supabase",
                "lifecycle_status": "pending_delete",
            }
        if table == "files":
            return {"id": "replacement-file"}
        return None

    async def fake_update_many(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> list[dict[str, Any]]:
        updates.append((table, filters, payload))
        return []

    async def delete_must_not_run(storage_path: str) -> bool:
        raise AssertionError(f"active storage object must be retained: {storage_path}")

    monkeypatch.setattr(lifecycle, "select_one_trusted", fake_select)
    monkeypatch.setattr(lifecycle, "update_many_trusted", fake_update_many)
    monkeypatch.setattr(lifecycle, "delete_storage_object", delete_must_not_run)

    result = await lifecycle.handle_cleanup_file_storage(
        {"payload": {"file_version_id": "version-1"}}
    )

    assert result == {"status": "completed", "outcome": "retained"}
    assert updates[0][1] == {
        "storage_path": "supabase://files/uploads/user/object.pdf",
        "lifecycle_status": "pending_delete",
    }
    assert updates[0][2]["lifecycle_status"] == "retained"


@pytest.mark.asyncio
async def test_cleanup_deletes_unreferenced_object_and_marks_all_pending_versions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deleted_paths: list[str] = []
    updates: list[dict[str, Any]] = []

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        if table == "file_versions" and filters == {"id": "version-2"}:
            return {
                "id": "version-2",
                "storage_path": "/managed/user/object.txt",
                "storage_backend": "local",
                "lifecycle_status": "pending_delete",
            }
        return None

    async def fake_delete(storage_path: str) -> bool:
        deleted_paths.append(storage_path)
        return True

    async def fake_update_many(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> list[dict[str, Any]]:
        updates.append(payload)
        return []

    monkeypatch.setattr(lifecycle, "select_one_trusted", fake_select)
    monkeypatch.setattr(lifecycle, "delete_storage_object", fake_delete)
    monkeypatch.setattr(lifecycle, "update_many_trusted", fake_update_many)

    result = await lifecycle.handle_cleanup_file_storage(
        {"payload": {"file_version_id": "version-2"}}
    )

    assert result == {"status": "completed", "outcome": "deleted"}
    assert deleted_paths == ["/managed/user/object.txt"]
    assert updates[-1]["lifecycle_status"] == "deleted"
    assert updates[-1]["cleaned_at"]


@pytest.mark.asyncio
async def test_cleanup_storage_failure_stays_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        if table == "file_versions" and filters == {"id": "version-3"}:
            return {
                "id": "version-3",
                "storage_path": "supabase://files/uploads/user/retry.pdf",
                "storage_backend": "supabase",
                "lifecycle_status": "pending_delete",
            }
        return None

    async def fail_delete(storage_path: str) -> bool:
        raise lifecycle.StorageError("storage unavailable")

    async def update_must_not_run(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError("Failed physical cleanup must remain pending.")

    monkeypatch.setattr(lifecycle, "select_one_trusted", fake_select)
    monkeypatch.setattr(lifecycle, "delete_storage_object", fail_delete)
    monkeypatch.setattr(lifecycle, "update_many_trusted", update_must_not_run)

    result = await lifecycle.handle_cleanup_file_storage(
        {"payload": {"file_version_id": "version-3"}}
    )

    assert result == {"status": "failed", "error": "storage cleanup failed"}


@pytest.mark.asyncio
async def test_expiry_revalidates_due_state_then_deletes_storage_before_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 7, 28, 10, 0, tzinfo=timezone.utc)
    events: list[tuple[str, Any]] = []

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        assert table == "files"
        return {
            "id": "file-1",
            "storage_path": "supabase://files/uploads/user/expired.pdf",
            "retention_expires_at": (now - timedelta(minutes=1)).isoformat(),
            "lifecycle_status": "retention_pending",
        }

    async def fake_delete_storage(storage_path: str) -> bool:
        events.append(("storage", storage_path))
        return False

    async def fake_delete_rows(
        table: str,
        filters: dict[str, Any],
    ) -> list[dict[str, Any]]:
        events.append(("database", filters))
        return [{"id": "file-1"}]

    monkeypatch.setattr(lifecycle, "_utcnow", lambda: now)
    monkeypatch.setattr(lifecycle, "select_one_trusted", fake_select)
    monkeypatch.setattr(lifecycle, "delete_storage_object", fake_delete_storage)
    monkeypatch.setattr(lifecycle, "delete_many_trusted", fake_delete_rows)

    result = await lifecycle.handle_expire_file({"payload": {"file_id": "file-1"}})

    assert result == {
        "status": "completed",
        "outcome": "expired",
        "storage_missing": True,
    }
    assert events == [
        ("storage", "supabase://files/uploads/user/expired.pdf"),
        (
            "database",
            {"id": "file-1", "lifecycle_status": "retention_pending"},
        ),
    ]


@pytest.mark.asyncio
async def test_expiry_restores_active_state_when_policy_is_no_longer_due(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 7, 28, 10, 0, tzinfo=timezone.utc)
    updates: list[tuple[dict[str, Any], dict[str, Any]]] = []

    async def fake_select(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {
            "id": "file-2",
            "storage_path": "/managed/user/future.txt",
            "retention_expires_at": (now + timedelta(days=1)).isoformat(),
            "lifecycle_status": "retention_pending",
        }

    async def fake_update(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        updates.append((filters, payload))
        return {"id": "file-2"}

    async def delete_must_not_run(storage_path: str) -> bool:
        raise AssertionError(storage_path)

    monkeypatch.setattr(lifecycle, "_utcnow", lambda: now)
    monkeypatch.setattr(lifecycle, "select_one_trusted", fake_select)
    monkeypatch.setattr(lifecycle, "update_one_trusted", fake_update)
    monkeypatch.setattr(lifecycle, "delete_storage_object", delete_must_not_run)

    result = await lifecycle.handle_expire_file({"payload": {"file_id": "file-2"}})

    assert result == {"status": "completed", "outcome": "not_due"}
    assert updates == [
        (
            {"id": "file-2", "lifecycle_status": "retention_pending"},
            {"lifecycle_status": "active"},
        )
    ]


@pytest.mark.asyncio
async def test_maintenance_only_enqueues_objects_older_than_grace_period(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 7, 28, 10, 0, tzinfo=timezone.utc)
    enqueued_paths: list[str] = []

    async def fake_expired(*, limit: int) -> int:
        assert limit == 2
        return 1

    async def fake_list(*, limit: int) -> list[SimpleNamespace]:
        assert limit == 2
        return [
            SimpleNamespace(
                storage_path="/managed/old.txt",
                storage_backend="local",
                modified_at=now - timedelta(hours=2),
            ),
            SimpleNamespace(
                storage_path="/managed/new.txt",
                storage_backend="local",
                modified_at=now - timedelta(minutes=5),
            ),
        ]

    async def fake_orphan(storage_path: str, storage_backend: str) -> str:
        assert storage_backend == "local"
        enqueued_paths.append(storage_path)
        return "queued"

    monkeypatch.setattr(lifecycle, "enqueue_expired_file_jobs", fake_expired)
    monkeypatch.setattr(lifecycle, "list_managed_storage_objects", fake_list)
    monkeypatch.setattr(lifecycle, "enqueue_orphan_file_cleanup", fake_orphan)

    result = await lifecycle.run_file_lifecycle_maintenance_once(
        now=now,
        scan_limit=2,
        orphan_grace_seconds=3600,
    )

    assert enqueued_paths == ["/managed/old.txt"]
    assert result == {
        "expired_jobs": 1,
        "objects_scanned": 2,
        "orphan_jobs": 1,
        "referenced_objects": 0,
    }


@pytest.mark.asyncio
async def test_worker_routes_cleanup_failures_through_bounded_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job_row = {
        "id": "job-1",
        "type": "cleanup_file_storage",
        "status": "queued",
        "attempts": 0,
        "payload": {"file_version_id": "version-1"},
    }
    updates: list[dict[str, Any]] = []
    pushed: list[str] = []

    async def fake_select(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return dict(job_row)

    async def fake_update(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        updates.append(payload)
        return {**job_row, **payload}

    async def fake_handler(row: dict[str, Any]) -> dict[str, Any]:
        assert row["attempts"] == 1
        return {"status": "failed", "error": "storage cleanup failed"}

    async def fake_push(job_id: str, *, queue_name: str | None = None) -> None:
        pushed.append(job_id)

    RuntimeManager._instance = None
    runtime = RuntimeManager.get()
    runtime.register_worker(worker._worker_id(), [], worker_type="ingestion")
    monkeypatch.setattr(worker, "select_one_trusted", fake_select)
    monkeypatch.setattr(worker, "update_one_trusted", fake_update)
    monkeypatch.setattr(worker, "handle_cleanup_file_storage", fake_handler)
    monkeypatch.setattr(worker, "_push_retry_job", fake_push)

    await worker._process_job("job-1")

    assert any(update.get("status") == "queued" for update in updates)
    assert pushed == ["job-1"]
