from __future__ import annotations

from datetime import datetime, timezone
import os
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest

from app.services import file_storage


@pytest.mark.asyncio
async def test_local_storage_save_read_delete_roundtrip(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.delenv("OMNIX_FILE_STORAGE_BACKEND", raising=False)
    monkeypatch.setenv("OMNIX_UPLOAD_DIR", str(tmp_path))

    storage_path = await file_storage.save_bytes_to_user_upload(
        "user-1",
        "../../release.md",
        b"# Release",
    )

    assert storage_path.startswith(str(tmp_path.resolve()))
    assert await file_storage.read_bytes_from_storage(storage_path) == b"# Release"
    assert await file_storage.delete_storage_object(storage_path) is True
    assert await file_storage.delete_storage_object(storage_path) is False


@pytest.mark.asyncio
async def test_local_storage_rejects_paths_outside_upload_root(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.delenv("OMNIX_FILE_STORAGE_BACKEND", raising=False)
    monkeypatch.setenv("OMNIX_UPLOAD_DIR", str(tmp_path / "uploads"))
    secret_file = tmp_path / "secret.txt"
    secret_file.write_text("do not read", encoding="utf-8")

    with pytest.raises(file_storage.StorageNotFoundError):
        await file_storage.read_bytes_from_storage(secret_file)


@pytest.mark.asyncio
async def test_local_storage_listing_is_bounded_oldest_first_and_skips_symlinks(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.delenv("OMNIX_FILE_STORAGE_BACKEND", raising=False)
    managed_root = tmp_path / "uploads"
    monkeypatch.setenv("OMNIX_UPLOAD_DIR", str(managed_root))
    user_dir = managed_root / "user-1"
    user_dir.mkdir(parents=True)

    oldest = user_dir / "oldest.txt"
    tied_a = user_dir / "a-tied.txt"
    tied_b = user_dir / "b-tied.txt"
    newest = user_dir / "newest.txt"
    for path in (oldest, tied_a, tied_b, newest):
        path.write_text(path.name, encoding="utf-8")

    os.utime(oldest, (1_700_000_000, 1_700_000_000))
    os.utime(tied_a, (1_700_000_100, 1_700_000_100))
    os.utime(tied_b, (1_700_000_100, 1_700_000_100))
    os.utime(newest, (1_700_000_200, 1_700_000_200))

    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    outside_file = outside_dir / "secret.txt"
    outside_file.write_text("secret", encoding="utf-8")
    (managed_root / "escaped-directory").symlink_to(outside_dir, target_is_directory=True)
    (user_dir / "escaped-file.txt").symlink_to(outside_file)

    objects = await file_storage.list_managed_storage_objects(limit=3)

    assert [item.storage_path for item in objects] == [
        str(oldest.resolve()),
        str(tied_a.resolve()),
        str(tied_b.resolve()),
    ]
    assert all(item.modified_at.tzinfo is not None for item in objects)
    assert all(item.modified_at.utcoffset() is not None for item in objects)
    assert all(item.storage_backend == "local" for item in objects)
    assert all(str(outside_dir.resolve()) not in item.storage_path for item in objects)


@pytest.mark.asyncio
async def test_supabase_storage_save_read_delete_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", "supabase")
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BUCKET", "omnix-test")

    class FakeBucket:
        def __init__(self) -> None:
            self.objects: dict[str, bytes] = {}
            self.upload_options: dict[str, dict[str, str] | None] = {}

        def upload(self, path: str, data: bytes, file_options: dict[str, str] | None = None) -> dict[str, str]:
            self.objects[path] = bytes(data)
            self.upload_options[path] = file_options
            return {"path": path}

        def download(self, path: str) -> bytes:
            if path not in self.objects:
                raise RuntimeError("not found")
            return self.objects[path]

        def remove(self, paths: list[str]) -> dict[str, list[str]]:
            for path in paths:
                if path not in self.objects:
                    raise RuntimeError("not found")
                del self.objects[path]
            return {"removed": paths}

    class FakeStorage:
        def __init__(self) -> None:
            self.bucket = FakeBucket()

        def from_(self, bucket_name: str) -> FakeBucket:
            assert bucket_name == "omnix-test"
            return self.bucket

    class FakeSupabase:
        def __init__(self) -> None:
            self.storage = FakeStorage()

    fake_supabase = FakeSupabase()

    import app.db.supabase_client as supabase_client

    monkeypatch.setattr(supabase_client, "get_supabase", lambda: fake_supabase)

    storage_ref = await file_storage.save_bytes_to_user_upload(
        "user-1",
        "notes.md",
        b"shared storage",
        content_type="text/markdown",
    )

    parsed = urlparse(storage_ref)
    assert parsed.scheme == "supabase"
    assert parsed.netloc == "omnix-test"
    object_path = parsed.path.lstrip("/")
    assert object_path.startswith("uploads/user-1/")
    assert fake_supabase.storage.bucket.upload_options[object_path] == {"content-type": "text/markdown"}
    assert await file_storage.read_bytes_from_storage(storage_ref) == b"shared storage"
    assert await file_storage.delete_storage_object(storage_ref) is True
    assert await file_storage.delete_storage_object(storage_ref) is False


@pytest.mark.asyncio
async def test_supabase_storage_listing_paginates_folders_and_normalizes_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", "supabase")
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BUCKET", "omnix-test")
    monkeypatch.setattr(file_storage, "_SUPABASE_LIST_PAGE_SIZE", 2)

    class ListResponse:
        def __init__(self, data) -> None:
            self.data = data

    pages = {
        ("uploads", 0): [
            {"name": "user-b", "id": None, "metadata": None},
            SimpleNamespace(name="user-a", id=None, metadata=None),
        ],
        ("uploads", 2): [],
        ("uploads/user-b", 0): ListResponse(
            [
                {
                    "name": "middle.txt",
                    "id": "file-middle",
                    "updated_at": "2025-01-02T00:00:00Z",
                    "metadata": {"size": 10},
                },
                {"name": "archive", "id": None, "metadata": None},
            ]
        ),
        ("uploads/user-b", 2): [
            SimpleNamespace(
                name="newest.txt",
                id="file-newest",
                updated_at=datetime(2025, 1, 4),
                metadata={"size": 20},
            )
        ],
        ("uploads/user-a", 0): [
            SimpleNamespace(
                name="oldest.txt",
                id="file-oldest",
                created_at="2025-01-01T00:00:00+00:00",
                metadata={"size": 30},
            )
        ],
        ("uploads/user-b/archive", 0): [
            {
                "name": "nested.txt",
                "id": "file-nested",
                "metadata": {"lastModified": "2025-01-03T00:00:00+00:00"},
            }
        ],
    }
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeBucket:
        async def list(self, path: str, options: dict[str, object]):
            calls.append((path, options))
            return pages[(path, options["offset"])]

    monkeypatch.setattr(file_storage, "_supabase_bucket", lambda bucket: FakeBucket())

    objects = await file_storage.list_managed_storage_objects(limit=10)

    assert [item.storage_path for item in objects] == [
        "supabase://omnix-test/uploads/user-a/oldest.txt",
        "supabase://omnix-test/uploads/user-b/middle.txt",
        "supabase://omnix-test/uploads/user-b/archive/nested.txt",
        "supabase://omnix-test/uploads/user-b/newest.txt",
    ]
    assert all(item.storage_backend == "supabase" for item in objects)
    assert all(item.modified_at.tzinfo is timezone.utc for item in objects)
    assert [(path, options["offset"]) for path, options in calls] == [
        ("uploads", 0),
        ("uploads", 2),
        ("uploads/user-b", 0),
        ("uploads/user-b", 2),
        ("uploads/user-a", 0),
        ("uploads/user-b/archive", 0),
    ]
    assert all(options["limit"] == 2 for _, options in calls)
    assert all(options["sortBy"] == {"column": "name", "order": "asc"} for _, options in calls)


@pytest.mark.asyncio
async def test_supabase_storage_listing_bounds_results_and_api_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", "supabase")
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BUCKET", "omnix-test")
    monkeypatch.setattr(file_storage, "_SUPABASE_LIST_PAGE_SIZE", 2)
    monkeypatch.setattr(file_storage, "_SUPABASE_LIST_MAX_API_PAGES", 2)
    calls: list[tuple[str, int]] = []

    class FakeBucket:
        def list(self, path: str, options: dict[str, object]):
            offset = int(options["offset"])
            calls.append((path, offset))
            if path == "uploads":
                return [{"name": "user-1", "id": None, "metadata": None}]
            return [
                {
                    "name": f"file-{offset + index}.txt",
                    "id": f"file-{offset + index}",
                    "updated_at": f"2025-01-0{index + 1}T00:00:00Z",
                    "metadata": {"size": index},
                }
                for index in range(2)
            ]

    monkeypatch.setattr(file_storage, "_supabase_bucket", lambda bucket: FakeBucket())

    objects = await file_storage.list_managed_storage_objects(limit=10)

    assert len(objects) == 2
    assert calls == [("uploads", 0), ("uploads/user-1", 0)]


@pytest.mark.asyncio
async def test_supabase_storage_listing_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", "supabase")

    def unavailable_bucket(bucket: str):
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(file_storage, "_supabase_bucket", unavailable_bucket)

    with pytest.raises(file_storage.StorageError, match="Failed to list files"):
        await file_storage.list_managed_storage_objects()


@pytest.mark.asyncio
async def test_unknown_storage_backend_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", "mystery")

    with pytest.raises(file_storage.StorageError, match="Unsupported file storage backend"):
        await file_storage.save_bytes_to_user_upload("user-1", "notes.md", b"content")

    with pytest.raises(file_storage.StorageError, match="Unsupported file storage backend"):
        await file_storage.list_managed_storage_objects()


@pytest.mark.asyncio
async def test_discard_uncommitted_storage_object_suppresses_cleanup_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    attempted_paths: list[str] = []

    async def fake_delete(storage_path: str) -> bool:
        attempted_paths.append(storage_path)
        raise file_storage.StorageError("storage unavailable")

    monkeypatch.setattr(file_storage, "delete_storage_object", fake_delete)

    await file_storage.discard_uncommitted_storage_object("supabase://omnix-test/uploads/user-1/notes.md")

    assert attempted_paths == ["supabase://omnix-test/uploads/user-1/notes.md"]
