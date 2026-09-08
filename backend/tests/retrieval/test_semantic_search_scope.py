from __future__ import annotations

from typing import Any

import pytest

from app.rag.vector_store_base import VectorStore
from app.retrieval import semantic_search
from app.retrieval.outcomes import RetrievalChannelError


class _Store(VectorStore):
    def add_embeddings(
        self,
        embeddings: list[list[float]],
        ids: list[str],
        user_ids: list[str],
        workspace_ids: list[str] | None = None,
    ) -> None:
        return None

    def search(
        self,
        query_embedding: list[float],
        user_id: str,
        workspace_id: str | None = None,
        top_k: int = 3,
    ) -> list[tuple[str, float]]:
        return []


@pytest.mark.asyncio
async def test_fetch_chunks_uses_scalar_workspace_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_select(table: str, columns: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        captured["table"] = table
        captured["filters"] = filters
        return [
            {
                "id": "chunk-1",
                "workspace_id": "workspace-1",
                "file_id": "file-1",
                "content": "Scoped document",
            }
        ]

    monkeypatch.setattr(semantic_search, "select_all_trusted", fake_select)
    search = semantic_search.SemanticSearch(_Store())

    rows = await search._fetch_chunks(["chunk-1"], user_id="user-1", workspace_id="workspace-1")

    assert rows[0]["id"] == "chunk-1"
    assert captured == {
        "table": "documents",
        "filters": {"id": ["chunk-1"], "workspace_id": "workspace-1"},
    }


@pytest.mark.asyncio
async def test_fetch_files_uses_in_workspace_filter_for_multiple_scopes(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_select(table: str, columns: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        captured["table"] = table
        captured["filters"] = filters
        return [
            {"id": "file-1", "workspace_id": "workspace-1", "file_name": "A.md"},
            {"id": "file-2", "workspace_id": "workspace-2", "file_name": "B.md"},
            {"id": "file-3", "workspace_id": "workspace-3", "file_name": "Blocked.md"},
        ]

    monkeypatch.setattr(semantic_search, "select_all_trusted", fake_select)
    search = semantic_search.SemanticSearch(_Store())

    rows = await search._fetch_files(
        ["file-1", "file-2", "file-3"],
        user_id="user-1",
        workspace_id=["workspace-1", "workspace-2"],
    )

    assert set(rows) == {"file-1", "file-2"}
    assert captured == {
        "table": "files",
        "filters": {
            "id": ["file-1", "file-2", "file-3"],
            "workspace_id": ["workspace-1", "workspace-2"],
        },
    }


@pytest.mark.asyncio
async def test_vector_store_failure_is_exposed_to_hybrid_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingStore(_Store):
        def search(self, *args: Any, **kwargs: Any) -> list[tuple[str, float]]:
            raise RuntimeError("vector index unavailable")

    async def fake_embedding(_query: str) -> list[float]:
        return [0.1]

    monkeypatch.setattr(semantic_search, "get_embedding", fake_embedding)
    monkeypatch.setattr(semantic_search, "validate_embedding_dimension", lambda *args, **kwargs: None)
    search = semantic_search.SemanticSearch(FailingStore())

    with pytest.raises(RetrievalChannelError) as exc_info:
        await search.search("find notes", user_id="user-1", workspace_id="workspace-1")

    assert exc_info.value.component == "semantic"
    assert exc_info.value.code == "vector_store_unavailable"
