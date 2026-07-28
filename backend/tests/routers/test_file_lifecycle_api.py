from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers import files
from app.schemas.chat import FileRetentionUpdate
from app.services.workspace_common import WorkspaceAccess

NOW = datetime(2026, 7, 28, 12, 0, tzinfo=timezone.utc)


def _file_row(
    *,
    user_id: str = "user-1",
    workspace_id: str | None = None,
    lifecycle_status: str = "active",
) -> dict[str, Any]:
    return {
        "id": "file-1",
        "user_id": user_id,
        "workspace_id": workspace_id,
        "conversation_id": None,
        "file_name": "release-plan.pdf",
        "file_type": "application/pdf",
        "size_bytes": 2048,
        "storage_path": "supabase://private-bucket/uploads/user-1/release-plan.pdf",
        "metadata": {},
        "retention_expires_at": None,
        "lifecycle_status": lifecycle_status,
    }


def _workspace_access(role: str = "member") -> WorkspaceAccess:
    return WorkspaceAccess(
        workspace={
            "id": "workspace-1",
            "user_id": "workspace-owner",
            "workspace_type": "workspace",
        },
        role=role,  # type: ignore[arg-type]
    )


def _version_row() -> dict[str, Any]:
    return {
        "id": "version-1",
        "file_id": "file-1",
        "version_number": 1,
        "file_name": "release-plan.pdf",
        "file_type": "application/pdf",
        "size_bytes": 2048,
        "content_hash": "sha256:release-plan",
        "storage_backend": "supabase",
        "storage_path": "supabase://private-bucket/uploads/user-1/release-plan.pdf",
        "lifecycle_status": "active",
        "cleanup_reason": None,
        "created_at": "2026-07-28T10:00:00+00:00",
        "cleanup_requested_at": None,
        "cleaned_at": None,
    }


@pytest.mark.asyncio
async def test_file_versions_authorize_before_history_and_never_return_storage_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, Any]] = []

    async def fake_require(
        file_id: str, user_id: str
    ) -> tuple[dict[str, Any], WorkspaceAccess]:
        events.append(("authorize", (file_id, user_id)))
        return _file_row(
            user_id="uploader-1", workspace_id="workspace-1"
        ), _workspace_access()

    async def fake_select(
        table: str,
        columns: str,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        events.append(("select", (table, columns, kwargs)))
        return [_version_row()]

    monkeypatch.setattr(files, "_require_file_access", fake_require)
    monkeypatch.setattr(files, "select_all_trusted", fake_select)

    versions = await files.get_file_versions(
        "file-1",
        limit=25,
        offset=10,
        current_user={"sub": "member-1"},
    )

    assert events == [
        ("authorize", ("file-1", "member-1")),
        (
            "select",
            (
                "file_versions",
                files.FILE_VERSION_COLUMNS,
                {
                    "filters": {"file_id": "file-1"},
                    "order_by": "version_number",
                    "desc": True,
                    "limit": 25,
                    "offset": 10,
                },
            ),
        ),
    ]
    assert "storage_path" not in files.FILE_VERSION_COLUMNS.split(",")
    assert versions[0]["file_id"] == "file-1"
    assert "storage_path" not in versions[0]


@pytest.mark.asyncio
async def test_file_versions_stop_when_file_access_is_denied(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def deny_access(file_id: str, user_id: str) -> tuple[dict[str, Any], None]:
        raise HTTPException(status_code=404, detail="File not found.")

    async def fail_select(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError(
            "Version history must not be selected before file authorization."
        )

    monkeypatch.setattr(files, "_require_file_access", deny_access)
    monkeypatch.setattr(files, "select_all_trusted", fail_select)

    with pytest.raises(HTTPException) as exc_info:
        await files.get_file_versions(
            "file-1",
            limit=50,
            offset=0,
            current_user={"sub": "outsider-1"},
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_personal_uploader_can_clear_retention_with_exact_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_row = _file_row()
    updates: list[tuple[str, dict[str, Any], dict[str, Any]]] = []

    async def fake_require(file_id: str, user_id: str) -> tuple[dict[str, Any], None]:
        assert (file_id, user_id) == ("file-1", "user-1")
        return file_row, None

    async def fake_update(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        updates.append((table, filters, payload))
        return {**file_row, **payload}

    async def fail_activity(**kwargs: Any) -> None:
        raise AssertionError(
            "Personal file retention must not emit workspace activity."
        )

    monkeypatch.setattr(files, "_require_file_access", fake_require)
    monkeypatch.setattr(files, "update_one_trusted", fake_update)
    monkeypatch.setattr(files, "log_workspace_activity", fail_activity)

    updated = await files.update_file_retention(
        "file-1",
        FileRetentionUpdate(retention_expires_at=None),
        current_user={"sub": "user-1"},
    )

    assert updates == [
        (
            "files",
            {
                "id": "file-1",
                "user_id": "user-1",
                "workspace_id": {"is": None},
                "lifecycle_status": "active",
            },
            {"retention_expires_at": None},
        )
    ]
    assert updated["retention_expires_at"] is None


@pytest.mark.asyncio
async def test_workspace_uploader_does_not_need_management_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_row = _file_row(workspace_id="workspace-1")
    captured_filters: list[dict[str, Any]] = []

    async def fake_require(
        file_id: str, user_id: str
    ) -> tuple[dict[str, Any], WorkspaceAccess]:
        return file_row, _workspace_access()

    def fail_management_check(*args: Any, **kwargs: Any) -> bool:
        raise AssertionError(
            "The uploader must be allowed without a management-role check."
        )

    async def fake_update(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "files"
        captured_filters.append(filters)
        return {**file_row, **payload}

    async def fake_activity(**kwargs: Any) -> None:
        return None

    monkeypatch.setattr(files, "_require_file_access", fake_require)
    monkeypatch.setattr(files, "can_manage_workspace_resource", fail_management_check)
    monkeypatch.setattr(files, "update_one_trusted", fake_update)
    monkeypatch.setattr(files, "log_workspace_activity", fake_activity)

    await files.update_file_retention(
        "file-1",
        FileRetentionUpdate(retention_expires_at=None),
        current_user={"sub": "user-1"},
    )

    assert captured_filters == [
        {
            "id": "file-1",
            "workspace_id": "workspace-1",
            "lifecycle_status": "active",
        }
    ]


@pytest.mark.asyncio
async def test_workspace_member_cannot_manage_another_uploaders_retention(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_row = _file_row(user_id="uploader-1", workspace_id="workspace-1")
    management_checks: list[tuple[str, str, str]] = []

    async def fake_require(
        file_id: str, user_id: str
    ) -> tuple[dict[str, Any], WorkspaceAccess]:
        return file_row, _workspace_access()

    def deny_management(
        record_user_id: str, access: WorkspaceAccess, current_user_id: str
    ) -> bool:
        management_checks.append((record_user_id, access.workspace_id, current_user_id))
        return False

    async def fail_update(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError(
            "Unauthorized retention changes must not reach the database."
        )

    monkeypatch.setattr(files, "_require_file_access", fake_require)
    monkeypatch.setattr(files, "can_manage_workspace_resource", deny_management)
    monkeypatch.setattr(files, "update_one_trusted", fail_update)

    with pytest.raises(HTTPException) as exc_info:
        await files.update_file_retention(
            "file-1",
            FileRetentionUpdate(retention_expires_at=NOW + timedelta(minutes=10)),
            current_user={"sub": "member-1"},
        )

    assert exc_info.value.status_code == 403
    assert management_checks == [("uploader-1", "workspace-1", "member-1")]


@pytest.mark.asyncio
async def test_workspace_manager_can_schedule_minimum_retention_without_sensitive_activity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_row = _file_row(user_id="uploader-1", workspace_id="workspace-1")
    updates: list[tuple[dict[str, Any], dict[str, Any]]] = []
    activity: list[dict[str, Any]] = []

    async def fake_require(
        file_id: str, user_id: str
    ) -> tuple[dict[str, Any], WorkspaceAccess]:
        return file_row, _workspace_access(role="founder")

    def allow_management(
        record_user_id: str, access: WorkspaceAccess, current_user_id: str
    ) -> bool:
        assert (record_user_id, access.workspace_id, current_user_id) == (
            "uploader-1",
            "workspace-1",
            "workspace-owner",
        )
        return True

    async def fake_update(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "files"
        updates.append((filters, payload))
        return {**file_row, **payload}

    async def fake_activity(**kwargs: Any) -> None:
        activity.append(kwargs)

    monkeypatch.setattr(files, "_require_file_access", fake_require)
    monkeypatch.setattr(files, "can_manage_workspace_resource", allow_management)
    monkeypatch.setattr(files, "update_one_trusted", fake_update)
    monkeypatch.setattr(files, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(files, "_utcnow", lambda: NOW)

    updated = await files.update_file_retention(
        "file-1",
        FileRetentionUpdate(retention_expires_at=NOW + timedelta(minutes=5)),
        current_user={"sub": "workspace-owner"},
    )

    expected_expiry = (NOW + timedelta(minutes=5)).isoformat()
    assert updates == [
        (
            {
                "id": "file-1",
                "workspace_id": "workspace-1",
                "lifecycle_status": "active",
            },
            {"retention_expires_at": expected_expiry},
        )
    ]
    assert updated["retention_expires_at"] == expected_expiry
    assert activity == [
        {
            "workspace_id": "workspace-1",
            "actor_user_id": "workspace-owner",
            "event_type": "workspace.source_retention_updated",
            "summary": "Retention was scheduled for release-plan.pdf.",
            "metadata": {
                "file_id": "file-1",
                "retention_expires_at": expected_expiry,
            },
        }
    ]
    assert "storage_path" not in repr(activity)


@pytest.mark.asyncio
async def test_retention_requires_five_minutes_and_authorizes_before_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    update_calls = 0

    async def fake_require(file_id: str, user_id: str) -> tuple[dict[str, Any], None]:
        return _file_row(), None

    async def fail_update(*args: Any, **kwargs: Any) -> dict[str, Any]:
        nonlocal update_calls
        update_calls += 1
        raise AssertionError("Invalid retention must not reach the database.")

    monkeypatch.setattr(files, "_require_file_access", fake_require)
    monkeypatch.setattr(files, "update_one_trusted", fail_update)
    monkeypatch.setattr(files, "_utcnow", lambda: NOW)

    with pytest.raises(HTTPException) as exc_info:
        await files.update_file_retention(
            "file-1",
            FileRetentionUpdate(
                retention_expires_at=NOW + timedelta(minutes=4, seconds=59)
            ),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 422
    assert update_calls == 0

    with pytest.raises(HTTPException) as naive_info:
        await files.update_file_retention(
            "file-1",
            FileRetentionUpdate(retention_expires_at=datetime(2026, 7, 29, 12, 0)),
            current_user={"sub": "user-1"},
        )

    assert naive_info.value.status_code == 422
    assert "timezone" in str(naive_info.value.detail).lower()

    async def deny_access(file_id: str, user_id: str) -> tuple[dict[str, Any], None]:
        raise HTTPException(status_code=404, detail="File not found.")

    monkeypatch.setattr(files, "_require_file_access", deny_access)
    with pytest.raises(HTTPException) as denied_info:
        await files.update_file_retention(
            "file-1",
            FileRetentionUpdate(retention_expires_at=NOW - timedelta(days=1)),
            current_user={"sub": "outsider-1"},
        )

    assert denied_info.value.status_code == 404


@pytest.mark.asyncio
async def test_retention_pending_cannot_be_cancelled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_require(file_id: str, user_id: str) -> tuple[dict[str, Any], None]:
        return _file_row(lifecycle_status="retention_pending"), None

    async def fail_update(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError("An in-progress expiry must not be cancelled.")

    monkeypatch.setattr(files, "_require_file_access", fake_require)
    monkeypatch.setattr(files, "update_one_trusted", fail_update)

    with pytest.raises(HTTPException) as exc_info:
        await files.update_file_retention(
            "file-1",
            FileRetentionUpdate(retention_expires_at=None),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_retention_lost_lifecycle_race_returns_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_filters: list[dict[str, Any]] = []

    async def fake_require(file_id: str, user_id: str) -> tuple[dict[str, Any], None]:
        return _file_row(), None

    async def lose_update(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> None:
        assert table == "files"
        assert payload == {"retention_expires_at": None}
        captured_filters.append(filters)
        return None

    monkeypatch.setattr(files, "_require_file_access", fake_require)
    monkeypatch.setattr(files, "update_one_trusted", lose_update)

    with pytest.raises(HTTPException) as exc_info:
        await files.update_file_retention(
            "file-1",
            FileRetentionUpdate(retention_expires_at=None),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 409
    assert captured_filters == [
        {
            "id": "file-1",
            "user_id": "user-1",
            "workspace_id": {"is": None},
            "lifecycle_status": "active",
        }
    ]


def test_retention_payload_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        FileRetentionUpdate.model_validate(
            {
                "retention_expires_at": None,
                "lifecycle_status": "active",
            }
        )
