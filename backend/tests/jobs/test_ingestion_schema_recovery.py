from __future__ import annotations

from copy import deepcopy
import json
import logging
import traceback
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
from postgrest import AsyncPostgrestClient
import pytest

from app.rag import ingestion
from app.rag.vector_store_base import VectorStore
from app.services import supabase_service as service

PRIVATE = "private-document-and-endpoint-sentinel"
BASE_URL = "https://database.invalid/rest/v1"
COLUMNS = ("metadata", "source_type", "updated_at")


def missing(column: str, code: str = "PGRST204", table: str = "documents") -> dict:
    message = (
        f"Could not find the '{column}' column of '{table}' in the schema cache"
        if code == "PGRST204"
        else f'column "{column}" of relation "{table}" does not exist'
    )
    return {"code": code, "message": message, "details": PRIVATE, "hint": PRIVATE}


@pytest.fixture
def payloads() -> list[dict]:
    return [
        {
            "id": f"chunk-{index}",
            "user_id": "user-1",
            "workspace_id": "workspace-1",
            "file_id": "file-1",
            "content": PRIVATE,
            "embedding": [0.1, 0.2],
            "chunk_index": index,
            "created_at": "timestamp",
            "metadata": {"page": index},
            "source_type": "pdf",
            "updated_at": "timestamp",
        }
        for index in range(2)
    ]


@pytest.fixture
def transport_client(monkeypatch):
    async def run(respond, operation):
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(respond), base_url=BASE_URL
        ) as http:
            client = AsyncPostgrestClient(BASE_URL, http_client=http)

            async def get_client():
                return SimpleNamespace(table=client.from_)

            monkeypatch.setattr(service, "_async_client", get_client)
            return await operation()

    return run


def assert_private_error_hidden(caplog, error=None):
    assert PRIVATE not in caplog.text
    assert all(PRIVATE not in repr(record.args) for record in caplog.records)
    if error is not None:
        assert PRIVATE not in str(error)
        assert PRIVATE not in "".join(traceback.format_exception(error))


@pytest.mark.asyncio
@pytest.mark.parametrize("column", COLUMNS)
@pytest.mark.parametrize("code", ["PGRST204", "42703"])
async def test_optional_column_recovers_through_real_insert_boundary(
    transport_client, payloads, caplog, column, code
):
    original = deepcopy(payloads)
    requests = []

    def respond(request):
        assert request.method == "POST" and request.url.path == "/rest/v1/documents"
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(400, json=missing(column, code))
        return httpx.Response(201, json=requests[-1])

    await transport_client(
        respond,
        lambda: ingestion.RAGIngestionPipeline._insert_document_payloads(payloads),
    )
    assert requests == [
        original,
        [{k: v for k, v in p.items() if k != column} for p in original],
    ]
    assert payloads == original
    assert "Retrying document insert" in caplog.text
    assert_private_error_hidden(caplog)


@pytest.mark.asyncio
async def test_successive_optional_columns_have_bounded_recovery(
    transport_client, payloads, caplog
):
    original = deepcopy(payloads)
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        if len(requests) <= len(COLUMNS):
            return httpx.Response(400, json=missing(COLUMNS[len(requests) - 1]))
        return httpx.Response(201, json=requests[-1])

    await transport_client(
        respond,
        lambda: ingestion.RAGIngestionPipeline._insert_document_payloads(payloads),
    )
    assert len(requests) == 4
    for attempt, batch in enumerate(requests):
        assert batch == [
            {k: v for k, v in p.items() if k not in COLUMNS[:attempt]} for p in original
        ]
    assert payloads == original
    assert_private_error_hidden(caplog)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        missing("user_id"),
        missing("workspace_id"),
        missing("content"),
        missing("embedding"),
        missing("file_id"),
        missing("metadata", table="profiles"),
        {**missing("metadata"), "code": "42501"},
        {**missing("metadata"), "code": "23502"},
        {**missing("metadata"), "message": PRIVATE + " metadata does not exist"},
        {**missing("metadata"), "message": missing("metadata")["message"] + PRIVATE},
        {**missing("metadata"), "message": PRIVATE},
    ],
)
async def test_other_database_failures_never_strip_fields_or_retry(
    transport_client, payloads, caplog, error
):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(400, json=error)

    with pytest.raises(service.SupabaseServiceError) as caught:
        await transport_client(
            respond,
            lambda: ingestion.RAGIngestionPipeline._insert_document_payloads(payloads),
        )
    assert requests == [payloads]
    assert str(caught.value) == service.INTERNAL_DB_ERROR
    assert caught.value.__cause__ is None and caught.value.__suppress_context__
    assert_private_error_hidden(caplog, caught.value)


@pytest.mark.asyncio
async def test_repeated_missing_column_stops_after_one_compatibility_retry(
    transport_client, payloads, caplog
):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(400, json=missing("metadata"))

    with pytest.raises(service.SupabaseServiceError) as caught:
        await transport_client(
            respond,
            lambda: ingestion.RAGIngestionPipeline._insert_document_payloads(payloads),
        )
    assert len(requests) == 2
    assert "metadata" not in requests[-1][0]
    assert_private_error_hidden(caplog, caught.value)


@pytest.mark.asyncio
async def test_healthy_schema_keeps_all_optional_columns(transport_client, payloads):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(201, json=requests[-1])

    await transport_client(
        respond,
        lambda: ingestion.RAGIngestionPipeline._insert_document_payloads(payloads),
    )
    assert requests == [payloads]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation",
    [
        lambda: service.insert_one("documents", {"user_id": "user-1"}),
        lambda: service.insert_many_trusted("documents", [{"user_id": "user-1"}]),
        lambda: service.update_one(
            "documents", {"user_id": "user-1"}, {"metadata": {}}
        ),
        lambda: service.select_all("documents", "metadata", {"user_id": "user-1"}),
        lambda: service.insert_many("profiles", [{"user_id": "user-1"}]),
    ],
    ids=["single-insert", "trusted-batch", "update", "select", "other-table"],
)
async def test_compatibility_classification_is_scoped_to_document_batch_inserts(
    transport_client, caplog, operation
):
    with pytest.raises(service.SupabaseServiceError) as caught:
        await transport_client(
            lambda request: httpx.Response(400, json=missing("metadata")), operation
        )
    assert caught.value.missing_document_column is None
    assert caught.value.__cause__ is None and caught.value.__suppress_context__
    assert_private_error_hidden(caplog, caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("recover", [True, False])
async def test_full_pipeline_deletes_old_vectors_only_after_successful_insert(
    monkeypatch, transport_client, caplog, recover
):
    caplog.set_level(logging.WARNING)
    events = []
    old_chunks = AsyncMock(return_value=["old-chunk"])
    delete = AsyncMock(side_effect=lambda *args: events.append("delete"))
    embed = AsyncMock(return_value=[[0.1, 0.2]])
    monkeypatch.setattr(ingestion, "get_embeddings_async", embed)
    monkeypatch.setattr(ingestion, "get_expected_embedding_dimension", lambda: 2)
    monkeypatch.setattr(
        ingestion.RAGIngestionPipeline, "_existing_chunk_ids", old_chunks
    )
    monkeypatch.setattr(ingestion, "delete_many_trusted", delete)
    requests = []

    def respond(request):
        events.append("insert")
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(400, json=missing("metadata"))
        if not recover:
            return httpx.Response(400, json={"code": "23502", "message": PRIVATE})
        return httpx.Response(201, json=requests[-1])

    pipeline = ingestion.RAGIngestionPipeline(Mock(spec=VectorStore))

    async def ingest():
        return await pipeline.ingest_text(
            PRIVATE, user_id="user-1", document_id="file-1", workspace_id="workspace-1"
        )

    if recover:
        result = await transport_client(respond, ingest)
        assert result == (1, [requests[-1][0]["id"]])
        assert events == ["insert", "insert", "delete"]
        delete.assert_awaited_once_with("documents", {"id": ["old-chunk"]})
    else:
        with pytest.raises(RuntimeError, match="database stage") as caught:
            await transport_client(respond, ingest)
        assert events == ["insert", "insert"]
        delete.assert_not_awaited()
        assert_private_error_hidden(caplog, caught.value)
    old_chunks.assert_awaited_once_with(
        "file-1", user_id="user-1", workspace_id="workspace-1"
    )
    for batch in requests:
        assert batch[0]["user_id"] == "user-1"
        assert batch[0]["workspace_id"] == "workspace-1"
        assert batch[0]["file_id"] == "file-1"
        assert batch[0]["embedding"] == [0.1, 0.2]
    assert_private_error_hidden(caplog)
