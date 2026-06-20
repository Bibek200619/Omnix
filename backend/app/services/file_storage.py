from __future__ import annotations

import os
from pathlib import Path
import re
import stat
import unicodedata
import uuid

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]+")
DEFAULT_UPLOAD_DIR = "./uploads"


def upload_root(root: str | os.PathLike[str] | None = None) -> Path:
    return Path(root or os.environ.get("OMNIX_UPLOAD_DIR", DEFAULT_UPLOAD_DIR)).resolve()


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


async def save_bytes_to_user_upload(
    user_id: str,
    filename: str | None,
    data: bytes,
    *,
    root: str | os.PathLike[str] | None = None,
) -> str:
    safe_name = sanitize_filename(filename)
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
