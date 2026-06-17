from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.rag import startup
from app.rag.pgvector_store import PgVectorStore
from app.retrieval import semantic_search as semantic_module
from app.retrieval.semantic_search import SemanticSearch


class FakeRpcQuery:
    def __init__(self, client: "FakeSupabaseClient", name: str, payload: dict[str, Any]) -> None:
        self.client = client
        self.name = name
        self.payload = payload

    def execute(self):
        self.client.operations.append({"name": self.name, "payload": self.payload})
        return SimpleNamespace(
            data=[
                {
                    "id": "chunk-1",
                    "content": "Workspace launch decision notes",
                    "similarity": 0.82,
                }
            ]
        )


class FakeSupabaseClient:
    def __init__(self) -> None:
        self.operations: list[dict[str, Any]] = []

    def rpc(self, name: str, payload: dict[str, Any]) -> FakeRpcQuery:
        return FakeRpcQuery(self, name, payload)


async def _fake_select_all_trusted(
    table: str,
    columns: str,
    *,
    filters: dict[str, Any] | None = None,
    **kwargs: Any,
) -> list[dict[str, Any]]:
    if table == "documents":
        return [
            {
                "id": "chunk-1",
                "content": "Workspace launch decision notes",
                "file_id": "file-1",
                "created_at": "2026-06-17T00:00:00Z",
                "workspace_id": "workspace-a",
                "user_id": "user-a",
                "chunk_index": 0,
            }
        ]
    if table == "files":
        return [
            {
                "id": "file-1",
                "file_name": "launch.md",
                "metadata": {"source": "test"},
                "workspace_id": "workspace-a",
                "user_id": "user-a",
            }
        ]
    return []


async def _fake_select_all(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
    return []


@pytest.fixture
def pgvector_semantic_fakes(monkeypatch: pytest.MonkeyPatch) -> FakeSupabaseClient:
    client = FakeSupabaseClient()

    async def fake_get_embedding(query: str) -> list[float]:
        return [0.01] * 384

    monkeypatch.setattr(semantic_module, "get_embedding", fake_get_embedding)
    monkeypatch.setattr(
        semantic_module,
        "get_settings",
        lambda: SimpleNamespace(SIMILARITY_THRESHOLD=1.5),
    )
    monkeypatch.setattr(semantic_module, "select_all_trusted", _fake_select_all_trusted)
    monkeypatch.setattr(semantic_module, "select_all", _fake_select_all)

    import app.rag.pgvector_store as pgvector_module

    monkeypatch.setattr(pgvector_module, "get_supabase", lambda: client)
    return client


@pytest.mark.asyncio
async def test_pgvector_semantic_search_uses_match_documents_rpc(
    pgvector_semantic_fakes: FakeSupabaseClient,
) -> None:
    search = SemanticSearch(PgVectorStore())

    results = await search.search(
        "launch decisions",
        user_id="user-a",
        workspace_id=["workspace-a", "workspace-b"],
        top_k=5,
    )

    assert [operation["name"] for operation in pgvector_semantic_fakes.operations] == ["match_documents"]
    payload = pgvector_semantic_fakes.operations[0]["payload"]
    assert payload["match_count"] == 5
    assert payload["filter_user_id"] == "user-a"
    assert payload["filter_workspace_ids"] == ["workspace-a", "workspace-b"]
    assert payload["match_threshold"] == pytest.approx(-0.5)
    assert results[0].chunk_id == "chunk-1"
    assert results[0].file_name == "launch.md"
    assert results[0].distance == pytest.approx(0.18)


@pytest.mark.asyncio
async def test_pgvector_results_do_not_depend_on_process_local_index(
    monkeypatch: pytest.MonkeyPatch,
    pgvector_semantic_fakes: FakeSupabaseClient,
) -> None:
    monkeypatch.setattr(
        startup,
        "get_settings",
        lambda: SimpleNamespace(OMNIX_VECTOR_BACKEND="pgvector"),
    )

    first_store = await startup.initialize_vector_store()
    first_results = await SemanticSearch(first_store).search(
        "launch decisions",
        user_id="user-a",
        workspace_id="workspace-a",
        top_k=3,
    )

    await startup.shutdown_vector_store()

    second_store = await startup.initialize_vector_store()
    second_results = await SemanticSearch(second_store).search(
        "launch decisions",
        user_id="user-a",
        workspace_id="workspace-a",
        top_k=3,
    )

    assert [result.chunk_id for result in first_results] == ["chunk-1"]
    assert [result.chunk_id for result in second_results] == ["chunk-1"]
    assert first_store is not second_store
    assert [operation["name"] for operation in pgvector_semantic_fakes.operations] == [
        "match_documents",
        "match_documents",
    ]
