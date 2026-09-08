from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

from ..db.supabase_client import get_async_supabase
from ..services.file_storage import (
    StorageError,
    delete_storage_object,
    list_managed_storage_objects,
)
from ..services.supabase_service import (
    delete_many_trusted,
    select_one_trusted,
    update_many_trusted,
    update_one_trusted,
)

logger = logging.getLogger(__name__)

_DEFAULT_MAINTENANCE_INTERVAL_SECONDS = 6 * 60 * 60
_DEFAULT_ORPHAN_GRACE_SECONDS = 60 * 60
_DEFAULT_SCAN_LIMIT = 100
_MAX_SCAN_LIMIT = 500
_TERMINAL_VERSION_STATES = {"deleted", "missing", "retained"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _positive_env_int(name: str, default: int, *, maximum: int | None = None) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        logger.warning("Invalid integer for %s; using %d.", name, default)
        value = default
    value = max(1, value)
    return min(value, maximum) if maximum is not None else value


def lifecycle_maintenance_interval_seconds() -> int:
    return _positive_env_int(
        "OMNIX_FILE_LIFECYCLE_INTERVAL_SECONDS",
        _DEFAULT_MAINTENANCE_INTERVAL_SECONDS,
    )


def _job_payload(job_row: Mapping[str, Any]) -> Mapping[str, Any]:
    payload = job_row.get("payload")
    return payload if isinstance(payload, Mapping) else {}


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def _call_lifecycle_rpc(name: str, params: Mapping[str, Any]) -> Any:
    client = await get_async_supabase()
    response = await client.rpc(name, dict(params)).execute()
    return getattr(response, "data", None)


def _rpc_row_count(data: Any) -> int:
    if isinstance(data, list):
        return len(data)
    return 1 if isinstance(data, Mapping) and data else 0


async def enqueue_expired_file_jobs(*, limit: int = _DEFAULT_SCAN_LIMIT) -> int:
    bounded_limit = max(1, min(int(limit), _MAX_SCAN_LIMIT))
    data = await _call_lifecycle_rpc(
        "omnix_enqueue_expired_file_jobs",
        {"p_limit": bounded_limit},
    )
    return _rpc_row_count(data)


async def enqueue_orphan_file_cleanup(storage_path: str, storage_backend: str) -> str:
    data = await _call_lifecycle_rpc(
        "omnix_enqueue_orphan_file_cleanup",
        {
            "p_storage_path": storage_path,
            "p_storage_backend": storage_backend,
        },
    )
    if isinstance(data, list) and data and isinstance(data[0], Mapping):
        return str(data[0].get("disposition") or "unknown")
    if isinstance(data, Mapping):
        return str(data.get("disposition") or "unknown")
    return "unknown"


async def handle_cleanup_file_storage(job_row: Mapping[str, Any]) -> dict[str, Any]:
    version_id = str(_job_payload(job_row).get("file_version_id") or "").strip()
    if not version_id:
        return {"status": "failed", "error": "file version id is required"}

    version = await select_one_trusted(
        "file_versions",
        "id,storage_path,storage_backend,lifecycle_status",
        {"id": version_id},
    )
    if version is None:
        return {"status": "completed", "outcome": "version_missing"}

    version_state = str(version.get("lifecycle_status") or "")
    if version_state in _TERMINAL_VERSION_STATES:
        return {"status": "completed", "outcome": version_state}
    if version_state != "pending_delete":
        return {"status": "completed", "outcome": "not_pending"}

    storage_path = str(version.get("storage_path") or "").strip()
    if not storage_path:
        return {"status": "failed", "error": "file version storage path is missing"}

    active_file = await select_one_trusted(
        "files",
        "id",
        {"storage_path": storage_path},
    )
    active_version = await select_one_trusted(
        "file_versions",
        "id",
        {
            "storage_path": storage_path,
            "lifecycle_status": "active",
        },
    )
    if active_file is not None or active_version is not None:
        await update_many_trusted(
            "file_versions",
            {
                "storage_path": storage_path,
                "lifecycle_status": "pending_delete",
            },
            {
                "lifecycle_status": "retained",
                "cleanup_reason": "active_reference",
                "cleaned_at": _utcnow().isoformat(),
            },
        )
        return {"status": "completed", "outcome": "retained"}

    try:
        physically_deleted = await delete_storage_object(storage_path)
    except StorageError:
        logger.warning(
            "File lifecycle cleanup could not delete its storage object.",
            exc_info=True,
        )
        return {"status": "failed", "error": "storage cleanup failed"}

    outcome = "deleted" if physically_deleted else "missing"
    await update_many_trusted(
        "file_versions",
        {
            "storage_path": storage_path,
            "lifecycle_status": "pending_delete",
        },
        {
            "lifecycle_status": outcome,
            "cleaned_at": _utcnow().isoformat(),
        },
    )
    return {"status": "completed", "outcome": outcome}


async def handle_expire_file(job_row: Mapping[str, Any]) -> dict[str, Any]:
    file_id = str(_job_payload(job_row).get("file_id") or "").strip()
    if not file_id:
        return {"status": "failed", "error": "file id is required"}

    file_row = await select_one_trusted(
        "files",
        "id,storage_path,retention_expires_at,lifecycle_status",
        {"id": file_id},
    )
    if file_row is None:
        return {"status": "completed", "outcome": "file_missing"}

    if file_row.get("lifecycle_status") != "retention_pending":
        return {"status": "completed", "outcome": "retention_cancelled"}

    retention_expires_at = _parse_datetime(file_row.get("retention_expires_at"))
    if retention_expires_at is None or retention_expires_at > _utcnow():
        await update_one_trusted(
            "files",
            {"id": file_id, "lifecycle_status": "retention_pending"},
            {"lifecycle_status": "active"},
        )
        return {"status": "completed", "outcome": "not_due"}

    storage_path = str(file_row.get("storage_path") or "").strip()
    physically_deleted: bool | None = None
    if storage_path:
        try:
            physically_deleted = await delete_storage_object(storage_path)
        except StorageError:
            logger.warning(
                "Retention expiry could not delete its storage object.",
                exc_info=True,
            )
            return {"status": "failed", "error": "storage cleanup failed"}

    deleted_rows = await delete_many_trusted(
        "files",
        {
            "id": file_id,
            "lifecycle_status": "retention_pending",
        },
    )
    if not deleted_rows:
        remaining = await select_one_trusted("files", "id", {"id": file_id})
        if remaining is not None:
            return {
                "status": "failed",
                "error": "file lifecycle state changed during expiry",
            }

    return {
        "status": "completed",
        "outcome": "expired",
        "storage_missing": bool(storage_path and physically_deleted is False),
    }


async def run_file_lifecycle_maintenance_once(
    *,
    now: datetime | None = None,
    scan_limit: int | None = None,
    orphan_grace_seconds: int | None = None,
) -> dict[str, int]:
    bounded_limit = max(
        1,
        min(
            scan_limit
            if scan_limit is not None
            else _positive_env_int(
                "OMNIX_FILE_LIFECYCLE_SCAN_LIMIT",
                _DEFAULT_SCAN_LIMIT,
                maximum=_MAX_SCAN_LIMIT,
            ),
            _MAX_SCAN_LIMIT,
        ),
    )
    grace_seconds = max(
        1,
        orphan_grace_seconds
        if orphan_grace_seconds is not None
        else _positive_env_int(
            "OMNIX_FILE_ORPHAN_GRACE_SECONDS",
            _DEFAULT_ORPHAN_GRACE_SECONDS,
        ),
    )
    current_time = (now or _utcnow()).astimezone(timezone.utc)
    cutoff = current_time - timedelta(seconds=grace_seconds)

    expired_jobs = await enqueue_expired_file_jobs(limit=bounded_limit)
    storage_objects = await list_managed_storage_objects(limit=bounded_limit)
    orphan_jobs = 0
    referenced_objects = 0

    for storage_object in storage_objects:
        if storage_object.modified_at > cutoff:
            continue
        disposition = await enqueue_orphan_file_cleanup(
            storage_object.storage_path,
            storage_object.storage_backend,
        )
        if disposition == "queued":
            orphan_jobs += 1
        elif disposition == "referenced":
            referenced_objects += 1

    return {
        "expired_jobs": expired_jobs,
        "objects_scanned": len(storage_objects),
        "orphan_jobs": orphan_jobs,
        "referenced_objects": referenced_objects,
    }
