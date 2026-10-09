from __future__ import annotations

import logging
import traceback
from types import SimpleNamespace
from typing import Any

import httpx
from postgrest import AsyncPostgrestClient, SyncPostgrestClient
import pytest

from app.retrieval import keyword_search
from app.services import supabase_service as service

# Fabricated markers only: never load real environment credentials for these tests.
PRIVATE = "private-document-and-token-sentinel"
BASE_URL = "https://database.invalid/rest/v1"
ERRORS = {
    "database": {
        "code": "23502",
        "message": "constraint failure",
        "details": PRIVATE,
        "hint": PRIVATE,
    },
    "auth": {
        "code": "401",
        "message": "Invalid API key " + PRIVATE,
        "details": PRIVATE,
        "hint": PRIVATE,
    },
    "network": {
        "code": "PGRST000",
        "message": "connection reset " + PRIVATE,
        "details": PRIVATE,
        "hint": PRIVATE,
    },
}
OPERATIONS = [
    ("select_all", ("documents", "id,content", {"user_id": "user-1"})),
    (
        "select_all_trusted",
        ("documents", "id,content", {"workspace_id": "workspace-1"}),
    ),
    ("select_one", ("documents", "id,content", {"user_id": "user-1"})),
    (
        "select_one_trusted",
        ("documents", "id,content", {"workspace_id": "workspace-1"}),
    ),
    ("insert_one", ("documents", {"user_id": "user-1", "content": PRIVATE})),
    (
        "insert_one_trusted",
        ("documents", {"workspace_id": "workspace-1", "content": PRIVATE}),
    ),
    ("insert_many", ("documents", [{"user_id": "user-1", "content": PRIVATE}])),
    (
        "insert_many_trusted",
        ("documents", [{"workspace_id": "workspace-1", "content": PRIVATE}]),
    ),
    ("update_one", ("documents", {"user_id": "user-1"}, {"content": PRIVATE})),
    (
        "update_one_trusted",
        ("documents", {"workspace_id": "workspace-1"}, {"content": PRIVATE}),
    ),
    (
        "update_many_trusted",
        ("documents", {"workspace_id": "workspace-1"}, {"content": PRIVATE}),
    ),
    ("upsert_one", ("documents", {"user_id": "user-1", "content": PRIVATE}, "id")),
    ("delete_one_trusted", ("documents", {"workspace_id": "workspace-1"})),
    ("delete_many_trusted", ("documents", {"workspace_id": "workspace-1"})),
]


def assert_redacted(
    caplog: pytest.LogCaptureFixture, error: Exception | None = None
) -> None:
    assert PRIVATE not in caplog.text
    for record in caplog.records:
        assert PRIVATE not in repr(record.args)
        if record.name == service.__name__:
            assert record.exc_info is None
    if error is not None:
        assert isinstance(error, service.SupabaseServiceError)
        assert str(error) == service.INTERNAL_DB_ERROR
        assert error.__cause__ is None
        assert error.__suppress_context__ is True
        assert PRIVATE not in "".join(traceback.format_exception(error))


@pytest.fixture(autouse=True)
def no_retry_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    async def sleep(_delay: float) -> None:
        pass

    monkeypatch.setattr(service.time, "sleep", lambda _delay: None)
    monkeypatch.setattr(service.asyncio, "sleep", sleep)
    monkeypatch.setattr(service.random, "random", lambda: 0.0)
    monkeypatch.setattr(service, "_last_pressure_event", 0)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "args"), OPERATIONS, ids=[item[0] for item in OPERATIONS]
)
@pytest.mark.parametrize("category", ERRORS)
async def test_async_database_boundaries_redact_real_provider_errors(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    method: str,
    args: tuple[Any, ...],
    category: str,
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(401 if category == "auth" else 400, json=ERRORS[category])

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(respond), base_url=BASE_URL
    ) as http:
        client = AsyncPostgrestClient(BASE_URL, http_client=http)

        async def get_client() -> Any:
            return SimpleNamespace(table=client.from_)

        monkeypatch.setattr(service, "_async_client", get_client)
        with pytest.raises(service.SupabaseServiceError) as caught:
            await getattr(service, method)(*args)
        # Simulate an outer caller's exception logger, where chained raw causes used to escape.
        caplog.set_level(logging.WARNING)
        logging.getLogger("test.database.consumer").error(
            "Database failed", exc_info=caught.value
        )

    assert (
        len(requests) == 1
    )  # PostgREST database/auth errors must not be transport-retried.
    assert_redacted(caplog, caught.value)
    expected = (
        "backend API key"
        if category == "auth"
        else "unreachable"
        if category == "network"
        else "Supabase operation failed"
    )
    assert expected in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("recover", [False, True], ids=["exhausted", "recovered"])
@pytest.mark.parametrize("error_type", [httpx.ConnectError, httpx.ReadTimeout])
async def test_async_transport_retry_redacts_messages_and_keeps_recovery(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    recover: bool,
    error_type: type[httpx.TransportError],
) -> None:
    attempts: list[httpx.Request] = []
    delays: list[float] = []

    async def sleep(delay: float) -> None:
        delays.append(delay)

    monkeypatch.setattr(service.asyncio, "sleep", sleep)

    def respond(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        if recover and len(attempts) == 3:
            return httpx.Response(200, json=[{"id": "doc-1"}])
        raise error_type("connection reset: " + PRIVATE, request=request)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(respond), base_url=BASE_URL
    ) as http:
        client = AsyncPostgrestClient(BASE_URL, http_client=http)

        async def get_client() -> Any:
            return SimpleNamespace(table=client.from_)

        monkeypatch.setattr(service, "_async_client", get_client)
        if recover:
            rows = await service.select_all_trusted(
                "documents", "id", {"content": PRIVATE}
            )
            assert rows == [{"id": "doc-1"}]
            error = None
        else:
            with pytest.raises(service.SupabaseServiceError) as caught:
                await service.select_all_trusted(
                    "documents", "id", {"content": PRIVATE}
                )
            error = caught.value

    assert len(attempts) == 3
    assert delays == [0.5, 1.0]
    assert service.check_infrastructure_pressure()
    assert_redacted(caplog, error)
    assert "attempt 1/3" in caplog.text
    assert f"attempt {2 if recover else 3}/3" in caplog.text


@pytest.mark.parametrize("category", ERRORS)
def test_sync_rpc_normalizes_before_outer_exception_logging(
    caplog: pytest.LogCaptureFixture,
    category: str,
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(400, json=ERRORS[category])

    with httpx.Client(
        transport=httpx.MockTransport(respond), base_url=BASE_URL
    ) as http:
        client = SyncPostgrestClient(BASE_URL, http_client=http)
        with pytest.raises(Exception) as caught:
            service.execute_query_sync(
                client.rpc("search_documents_vector", {"q": PRIVATE}),
                operation="vector rpc",
            )
        logging.getLogger("test.vector.consumer").error(
            "Vector unavailable", exc_info=caught.value
        )

    assert len(requests) == 1
    assert_redacted(caplog, caught.value)


@pytest.mark.parametrize("recover", [False, True], ids=["exhausted", "recovered"])
@pytest.mark.parametrize("error_type", [httpx.ConnectError, httpx.ReadTimeout])
def test_sync_transport_retry_redacts_messages_and_keeps_recovery(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    recover: bool,
    error_type: type[httpx.TransportError],
) -> None:
    attempts: list[httpx.Request] = []
    delays: list[float] = []
    monkeypatch.setattr(service.time, "sleep", delays.append)

    def respond(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        if recover and len(attempts) == 3:
            return httpx.Response(200, json=[{"id": "doc-1"}])
        raise error_type("connection reset: " + PRIVATE, request=request)

    with httpx.Client(
        transport=httpx.MockTransport(respond), base_url=BASE_URL
    ) as http:
        client = SyncPostgrestClient(BASE_URL, http_client=http)
        query = client.from_("documents").select("id").eq("content", PRIVATE)
        if recover:
            assert service.execute_query_sync(
                query, operation="keyword files"
            ).data == [{"id": "doc-1"}]
            error = None
        else:
            with pytest.raises(Exception) as caught:
                service.execute_query_sync(query, operation="keyword files")
            error = caught.value

    assert len(attempts) == 3
    assert delays == [0.5, 1.0]
    assert service.check_infrastructure_pressure()
    assert_redacted(caplog, error)
    assert "attempt 1/3" in caplog.text
    assert f"attempt {2 if recover else 3}/3" in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("fallback_ok", [False, True])
async def test_real_keyword_consumer_cannot_log_raw_rpc_or_fallback_errors(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    fallback_ok: bool,
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if fallback_ok and "/rpc/" not in request.url.path:
            return httpx.Response(200, json=[])
        return httpx.Response(400, json=ERRORS["database"])

    with httpx.Client(
        transport=httpx.MockTransport(respond), base_url=BASE_URL
    ) as http:
        client = SyncPostgrestClient(BASE_URL, http_client=http)
        monkeypatch.setattr(
            keyword_search,
            "get_supabase",
            lambda: SimpleNamespace(rpc=client.rpc, table=client.from_),
        )
        search = keyword_search.KeywordSearch()
        if fallback_ok:
            assert (
                await search.search(
                    PRIVATE, user_id="user-1", workspace_id="workspace-1"
                )
                == []
            )
            error = None
        else:
            with pytest.raises(Exception) as caught:
                await search.search(
                    PRIVATE, user_id="user-1", workspace_id="workspace-1"
                )
            error = caught.value
    assert len(requests) == 2
    assert "/rpc/" in requests[0].url.path
    assert "workspace_id=eq.workspace-1" in str(requests[1].url)
    assert_redacted(caplog, error)


@pytest.mark.asyncio
async def test_successful_empty_and_scoped_reads_keep_their_meaning(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=[])

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(respond), base_url=BASE_URL
    ) as http:
        client = AsyncPostgrestClient(BASE_URL, http_client=http)

        async def get_client() -> Any:
            return SimpleNamespace(table=client.from_)

        monkeypatch.setattr(service, "_async_client", get_client)
        assert await service.select_all("documents", "id", {"user_id": "user-1"}) == []
        assert (
            await service.select_all_trusted(
                "documents", "id", {"workspace_id": "workspace-1"}
            )
            == []
        )
        with pytest.raises(service.SupabaseServiceError):
            await service.select_all("documents", "id", {"workspace_id": "workspace-1"})
        with pytest.raises(service.SupabaseServiceError):
            await service.select_all_trusted("documents", "id")
    assert len(requests) == 2
    assert "user_id=eq.user-1" in str(requests[0].url)
    assert "workspace_id=eq.workspace-1" in str(requests[1].url)
    assert_redacted(caplog)
