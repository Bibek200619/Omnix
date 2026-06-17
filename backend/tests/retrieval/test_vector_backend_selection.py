from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.rag import startup
from app.rag.pgvector_store import PgVectorStore
from app.rag.vector_store_base import VectorStore


class FakeFAISSStore(VectorStore):
    def __init__(self) -> None:
        self.loaded: tuple[str, str] | None = None
        self.saved: tuple[str, str] | None = None

    def add_embeddings(
        self,
        embeddings: list[list[float]],
        ids: list[str],
        user_ids: list[str],
        workspace_ids: list[str] | None = None,
    ) -> None:
        pass

    def search(
        self,
        query_embedding: list[float],
        user_id: str,
        workspace_id: str | list[str] | None = None,
        top_k: int = 3,
    ) -> list[tuple[str, float]]:
        return []

    def load_local(self, index_path: str, map_path: str) -> None:
        self.loaded = (index_path, map_path)

    def save_local(self, index_path: str, map_path: str) -> None:
        self.saved = (index_path, map_path)


@pytest.fixture(autouse=True)
async def reset_vector_store():
    await startup.shutdown_vector_store()
    yield
    await startup.shutdown_vector_store()


@pytest.mark.asyncio
async def test_pgvector_backend_skips_faiss_import(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        startup,
        "get_settings",
        lambda: SimpleNamespace(OMNIX_VECTOR_BACKEND="pgvector"),
    )
    sys.modules.pop("app.rag.faiss_store", None)

    store = await startup.initialize_vector_store()

    assert isinstance(store, PgVectorStore)
    assert startup.get_configured_vector_backend() == "pgvector"
    assert "app.rag.faiss_store" not in sys.modules


@pytest.mark.asyncio
async def test_faiss_backend_preserves_legacy_persistence(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    index_path = tmp_path / "faiss.index"
    map_path = tmp_path / "faiss_map.json"
    index_path.write_bytes(b"index")
    map_path.write_text("[]", encoding="utf-8")

    monkeypatch.setattr(
        startup,
        "get_settings",
        lambda: SimpleNamespace(
            OMNIX_VECTOR_BACKEND="faiss",
            FAISS_INDEX_PATH=str(index_path),
            FAISS_MAP_PATH=str(map_path),
        ),
    )
    monkeypatch.setattr(startup, "_load_faiss_store_class", lambda: FakeFAISSStore)

    store = await startup.initialize_vector_store()

    assert isinstance(store, FakeFAISSStore)
    assert store.loaded == (str(index_path), str(map_path))

    await startup.shutdown_vector_store()

    assert store.saved == (str(index_path), str(map_path))
