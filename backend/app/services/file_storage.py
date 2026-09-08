from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
import inspect
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath
import re
import stat
import unicodedata
import uuid
from typing import Any, Literal
from urllib.parse import urlparse

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]+")
DEFAULT_UPLOAD_DIR = "./uploads"
DEFAULT_STORAGE_BUCKET = "omnix-files"
_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_MANAGED_STORAGE_LIST_MAX_RESULTS = 1_000
_SUPABASE_LIST_PAGE_SIZE = 100
_SUPABASE_LIST_MAX_API_PAGES = 100

logger = logging.getLogger(__name__)


class StorageError(RuntimeError):
    pass


class StorageNotFoundError(StorageError):
    pass


@dataclass(frozen=True)
class SupabaseStorageRef:
    bucket: str
    object_path: str


@dataclass(frozen=True)
class ManagedStorageObject:
    storage_backend: Literal["local", "supabase"]
    storage_path: str
    modified_at: datetime

    def __post_init__(self) -> None:
        if self.modified_at.tzinfo is None or self.modified_at.utcoffset() is None:
            raise ValueError("modified_at must be timezone-aware")


def upload_root(root: str | os.PathLike[str] | None = None) -> Path:
    return Path(root or os.environ.get("OMNIX_UPLOAD_DIR", DEFAULT_UPLOAD_DIR)).resolve()


def storage_backend_name() -> str:
    return os.environ.get("OMNIX_FILE_STORAGE_BACKEND", "local").strip().lower() or "local"


def storage_is_shared() -> bool:
    """Return whether the configured storage is visible to every worker replica.

    Supabase storage is inherently shared. Local storage requires an explicit
    deployment declaration because a container-local upload directory is not
    visible to a separately scheduled worker.
    """
    if storage_backend_name() == "supabase":
        return True
    return os.environ.get("OMNIX_FILE_STORAGE_SHARED", "").strip().lower() in _TRUE_VALUES


def sanitize_filename(filename: str | None, *, fallback: str = "unnamed") -> str:
    raw = unicodedata.normalize("NFKD", filename or "")
    raw = os.path.basename(raw).replace("\x00", "")
    raw = _CONTROL_CHARS_RE.sub("", raw)
    safe = _SAFE_FILENAME_RE.sub("_", raw).strip("._")
    if not safe:
        safe = fallback

    stem, suffix = os.path.splitext(safe)
    if len(safe) > 255:
        safe = f"{stem[: max(1, 255 - len(suffix))]}{suffix}"
    return safe or fallback


def resolve_managed_storage_path(storage_path: str | os.PathLike[str] | None) -> Path | None:
    if not storage_path:
        return None

    try:
        root = upload_root()
        resolved = Path(storage_path).resolve()
        resolved.relative_to(root)
        return resolved
    except (OSError, RuntimeError, ValueError):
        return None


def _safe_supabase_object_path(object_path: str) -> str:
    path = PurePosixPath(object_path)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise StorageError("Invalid storage object path")
    return path.as_posix()


def _supabase_bucket_name(bucket: str | None = None) -> str:
    return bucket or os.environ.get("OMNIX_FILE_STORAGE_BUCKET", DEFAULT_STORAGE_BUCKET)


def _supabase_upload_key(user_id: str, filename: str) -> str:
    user_prefix = sanitize_filename(user_id, fallback="user")
    safe_name = sanitize_filename(filename)
    return _safe_supabase_object_path(f"uploads/{user_prefix}/{uuid.uuid4().hex}_{safe_name}")


def _supabase_storage_ref(bucket: str, object_path: str) -> str:
    return f"supabase://{bucket}/{_safe_supabase_object_path(object_path)}"


def _parse_supabase_storage_ref(storage_path: str | os.PathLike[str] | None) -> SupabaseStorageRef | None:
    if not storage_path:
        return None
    parsed = urlparse(str(storage_path))
    if parsed.scheme != "supabase":
        return None
    if not parsed.netloc:
        raise StorageError("Invalid Supabase storage bucket")
    object_path = parsed.path.lstrip("/")
    return SupabaseStorageRef(bucket=parsed.netloc, object_path=_safe_supabase_object_path(object_path))


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _supabase_bucket(bucket: str) -> Any:
    from ..db.supabase_client import get_supabase

    return get_supabase().storage.from_(bucket)


def _is_not_found_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "not found" in message or "404" in message or "no such file" in message


def _normalize_downloaded_bytes(result: Any) -> bytes:
    data = getattr(result, "data", result)
    if isinstance(data, bytes):
        return data
    if isinstance(data, bytearray):
        return bytes(data)
    if hasattr(data, "read"):
        read = data.read()
        if isinstance(read, str):
            return read.encode("utf-8")
        return bytes(read)
    raise StorageError(f"Unexpected storage download response: {type(result)!r}")


def _list_local_managed_storage_objects(
    root: str | os.PathLike[str] | None,
    limit: int,
) -> list[ManagedStorageObject]:
    managed_root = upload_root(root)
    if not managed_root.exists():
        return []
    if not managed_root.is_dir():
        raise StorageError("Managed upload root is not a directory")

    objects: list[ManagedStorageObject] = []

    def raise_walk_error(exc: OSError) -> None:
        raise exc

    try:
        for current_root, directory_names, file_names in os.walk(
            managed_root,
            topdown=True,
            onerror=raise_walk_error,
            followlinks=False,
        ):
            current_path = Path(current_root)
            current_path.resolve(strict=True).relative_to(managed_root)

            safe_directories: list[str] = []
            for directory_name in sorted(directory_names):
                directory_path = current_path / directory_name
                if directory_path.is_symlink():
                    continue
                try:
                    resolved_directory = directory_path.resolve(strict=True)
                except FileNotFoundError:
                    continue
                resolved_directory.relative_to(managed_root)
                if resolved_directory.is_dir():
                    safe_directories.append(directory_name)
            directory_names[:] = safe_directories

            for file_name in sorted(file_names):
                file_path = current_path / file_name
                if file_path.is_symlink():
                    continue
                try:
                    resolved_path = file_path.resolve(strict=True)
                    resolved_path.relative_to(managed_root)
                    file_stat = resolved_path.stat()
                except FileNotFoundError:
                    continue
                if not resolved_path.is_file():
                    continue
                objects.append(
                    ManagedStorageObject(
                        storage_backend="local",
                        storage_path=str(resolved_path),
                        modified_at=datetime.fromtimestamp(file_stat.st_mtime, timezone.utc),
                    )
                )
    except (OSError, RuntimeError, ValueError) as exc:
        raise StorageError("Failed to list files from local storage") from exc

    objects.sort(key=lambda item: (item.modified_at, item.storage_path))
    return objects[:limit]


def _supabase_entry_value(entry: Any, key: str) -> Any:
    if isinstance(entry, dict):
        return entry.get(key)
    return getattr(entry, key, None)


def _normalize_supabase_list_response(result: Any) -> list[Any]:
    error = result.get("error") if isinstance(result, dict) else getattr(result, "error", None)
    if error:
        raise StorageError("Supabase storage returned a listing error")

    if isinstance(result, dict) and "data" in result:
        data = result["data"]
    elif not isinstance(result, (list, tuple)) and hasattr(result, "data"):
        data = result.data
    else:
        data = result

    if not isinstance(data, (list, tuple)):
        raise StorageError(f"Unexpected storage list response: {type(result)!r}")
    return list(data)


def _normalize_storage_datetime(value: Any) -> datetime:
    try:
        if isinstance(value, datetime):
            parsed = value
        elif isinstance(value, str):
            normalized = value.strip()
            if normalized.endswith(("Z", "z")):
                normalized = f"{normalized[:-1]}+00:00"
            parsed = datetime.fromisoformat(normalized)
        elif isinstance(value, (int, float)):
            parsed = datetime.fromtimestamp(value, timezone.utc)
        else:
            raise TypeError(f"Unsupported timestamp type: {type(value)!r}")
    except (OverflowError, TypeError, ValueError) as exc:
        raise StorageError("Invalid storage object timestamp") from exc

    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _supabase_entry_modified_at(entry: Any) -> datetime:
    for key in ("updated_at", "created_at", "last_modified"):
        value = _supabase_entry_value(entry, key)
        if value is not None:
            return _normalize_storage_datetime(value)

    metadata = _supabase_entry_value(entry, "metadata")
    for key in ("lastModified", "last_modified"):
        value = _supabase_entry_value(metadata, key)
        if value is not None:
            return _normalize_storage_datetime(value)

    raise StorageError("Storage object is missing a modification timestamp")


def _supabase_entry_is_folder(entry: Any) -> bool:
    return _supabase_entry_value(entry, "id") is None and _supabase_entry_value(entry, "metadata") is None


def _supabase_child_path(directory: str, entry: Any) -> str:
    name = _supabase_entry_value(entry, "name")
    if not isinstance(name, str) or not name or name in {".", ".."} or "/" in name:
        raise StorageError("Invalid Supabase storage listing entry")
    object_path = _safe_supabase_object_path(f"{directory}/{name}")
    if not object_path.startswith("uploads/"):
        raise StorageError("Supabase storage listing escaped the managed prefix")
    return object_path


async def _list_supabase_managed_storage_objects(
    limit: int,
) -> list[ManagedStorageObject]:
    bucket_name = _supabase_bucket_name()
    directories = deque(["uploads"])
    visited_directories = {"uploads"}
    objects: list[ManagedStorageObject] = []
    api_pages = 0

    try:
        bucket = _supabase_bucket(bucket_name)
        while directories and len(objects) < limit and api_pages < _SUPABASE_LIST_MAX_API_PAGES:
            directory = directories.popleft()
            offset = 0
            while len(objects) < limit and api_pages < _SUPABASE_LIST_MAX_API_PAGES:
                options = {
                    "limit": _SUPABASE_LIST_PAGE_SIZE,
                    "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                }
                result = await _maybe_await(bucket.list(directory, options))
                api_pages += 1
                page = _normalize_supabase_list_response(result)

                for entry in page:
                    child_path = _supabase_child_path(directory, entry)
                    if _supabase_entry_is_folder(entry):
                        if child_path not in visited_directories:
                            visited_directories.add(child_path)
                            directories.append(child_path)
                        continue
                    objects.append(
                        ManagedStorageObject(
                            storage_backend="supabase",
                            storage_path=_supabase_storage_ref(bucket_name, child_path),
                            modified_at=_supabase_entry_modified_at(entry),
                        )
                    )
                    if len(objects) >= limit:
                        break

                if len(page) < _SUPABASE_LIST_PAGE_SIZE:
                    break
                offset += len(page)
    except StorageError:
        raise
    except Exception as exc:
        raise StorageError("Failed to list files from shared storage") from exc

    objects.sort(key=lambda item: (item.modified_at, item.storage_path))
    return objects[:limit]


async def list_managed_storage_objects(
    *,
    limit: int = 100,
    root: str | os.PathLike[str] | None = None,
) -> list[ManagedStorageObject]:
    """List a bounded set of objects owned by the configured storage backend."""
    backend_name = storage_backend_name()
    if backend_name not in {"local", "supabase"}:
        raise StorageError(f"Unsupported file storage backend: {backend_name}")
    if not isinstance(limit, int) or limit < 0:
        raise StorageError("Storage listing limit must be a non-negative integer")
    if limit == 0:
        return []

    bounded_limit = min(limit, _MANAGED_STORAGE_LIST_MAX_RESULTS)
    if backend_name == "supabase":
        return await _list_supabase_managed_storage_objects(bounded_limit)
    return await asyncio.to_thread(_list_local_managed_storage_objects, root, bounded_limit)


async def save_bytes_to_user_upload(
    user_id: str,
    filename: str | None,
    data: bytes,
    *,
    root: str | os.PathLike[str] | None = None,
    content_type: str | None = None,
) -> str:
    safe_name = sanitize_filename(filename)
    backend_name = storage_backend_name()
    if backend_name == "supabase":
        bucket_name = _supabase_bucket_name()
        object_path = _supabase_upload_key(user_id, safe_name)
        bucket = _supabase_bucket(bucket_name)
        options = {"content-type": content_type} if content_type else None
        try:
            if options:
                await _maybe_await(bucket.upload(object_path, data, file_options=options))
            else:
                await _maybe_await(bucket.upload(object_path, data))
        except Exception as exc:
            raise StorageError("Failed to upload file to shared storage") from exc
        return _supabase_storage_ref(bucket_name, object_path)
    if backend_name != "local":
        raise StorageError(f"Unsupported file storage backend: {backend_name}")

    user_dir = upload_root(root) / sanitize_filename(user_id, fallback="user")
    user_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(user_dir, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP)
    except OSError:
        pass

    path = user_dir / f"{uuid.uuid4().hex}_{safe_name}"
    path.write_bytes(data)
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP)
    except OSError:
        pass
    return str(path)


async def read_bytes_from_storage(storage_path: str | os.PathLike[str] | None) -> bytes:
    ref = _parse_supabase_storage_ref(storage_path)
    if ref is not None:
        try:
            downloaded = await _maybe_await(_supabase_bucket(ref.bucket).download(ref.object_path))
            return _normalize_downloaded_bytes(downloaded)
        except Exception as exc:
            if _is_not_found_error(exc):
                raise StorageNotFoundError("File content not found in shared storage") from exc
            raise StorageError("Failed to read file from shared storage") from exc

    local_path = resolve_managed_storage_path(storage_path)
    if local_path is None or not local_path.exists():
        raise StorageNotFoundError("File content not found on local storage")
    try:
        return local_path.read_bytes()
    except FileNotFoundError as exc:
        raise StorageNotFoundError("File content not found on local storage") from exc
    except OSError as exc:
        raise StorageError("Failed to read file from local storage") from exc


async def delete_storage_object(storage_path: str | os.PathLike[str] | None) -> bool:
    if not storage_path:
        return True

    ref = _parse_supabase_storage_ref(storage_path)
    if ref is not None:
        try:
            await _maybe_await(_supabase_bucket(ref.bucket).remove([ref.object_path]))
            return True
        except Exception as exc:
            if _is_not_found_error(exc):
                return False
            raise StorageError("Failed to delete file from shared storage") from exc

    local_path = resolve_managed_storage_path(storage_path)
    if local_path is None:
        return False
    try:
        local_path.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise StorageError("Failed to delete file from local storage") from exc


async def discard_uncommitted_storage_object(storage_path: str | os.PathLike[str] | None) -> None:
    """Best-effort rollback for an object whose file metadata was not persisted.

    A registration failure must not leave an otherwise unreachable upload behind.
    Cleanup is intentionally non-fatal so callers can return the original
    metadata-registration error to the user.
    """
    if not storage_path:
        return

    try:
        await delete_storage_object(storage_path)
    except Exception as exc:
        logger.warning(
            "Unable to discard an unregistered storage object (%s).",
            type(exc).__name__,
        )
