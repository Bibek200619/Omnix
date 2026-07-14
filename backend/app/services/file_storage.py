from __future__ import annotations

import inspect
import os
from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath
import re
import stat
import unicodedata
import uuid
from typing import Any
from urllib.parse import urlparse

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]+")
DEFAULT_UPLOAD_DIR = "./uploads"
DEFAULT_STORAGE_BUCKET = "omnix-files"
_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})


class StorageError(RuntimeError):
    pass


class StorageNotFoundError(StorageError):
    pass


@dataclass(frozen=True)
class SupabaseStorageRef:
    bucket: str
    object_path: str


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
