from __future__ import annotations

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
async def test_unknown_storage_backend_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", "mystery")

    with pytest.raises(file_storage.StorageError, match="Unsupported file storage backend"):
        await file_storage.save_bytes_to_user_upload("user-1", "notes.md", b"content")


@pytest.mark.asyncio
async def test_discard_uncommitted_storage_object_suppresses_cleanup_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    attempted_paths: list[str] = []

    async def fake_delete(storage_path: str) -> bool:
        attempted_paths.append(storage_path)
        raise file_storage.StorageError("storage unavailable")

    monkeypatch.setattr(file_storage, "delete_storage_object", fake_delete)

    await file_storage.discard_uncommitted_storage_object("supabase://omnix-test/uploads/user-1/notes.md")

    assert attempted_paths == ["supabase://omnix-test/uploads/user-1/notes.md"]
