from __future__ import annotations

import asyncio
import json
import logging
import sys
import traceback
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.embeddings import local_provider, openai_provider
from app.rag import embedding, ingestion
from app.rag.vector_store_base import VectorStore
from app.retrieval.outcomes import RetrievalChannelError
from app.retrieval.semantic_search import SemanticSearch

PRIVATE = "private-document-token-and-path-sentinel"


def _assert_safe(error: BaseException, caplog: pytest.LogCaptureFixture) -> None:
    assert PRIVATE not in str(error)
    assert PRIVATE not in "".join(traceback.format_exception(error))
    assert PRIVATE not in caplog.text
    for record in caplog.records:
        if record.name in {
            embedding.__name__,
            local_provider.__name__,
            openai_provider.__name__,
        }:
            assert record.exc_info is None
            assert PRIVATE not in str(record.args)


@pytest.fixture(autouse=True)
def _isolated_provider_state(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setenv("EMBEDDING_DIMENSION", "3")
    monkeypatch.setenv("OPENAI_EMBEDDING_DIMENSIONS", "3")
    monkeypatch.setenv("OPENAI_API_BASE", "https://embeddings.invalid/v1")
    monkeypatch.setattr(local_provider.LocalEmbeddingProvider, "_MODELS", {})
    monkeypatch.setattr(local_provider.LocalEmbeddingProvider, "_MODEL_DIMS", {})
    caplog.set_level(logging.WARNING)


@pytest.mark.asyncio
@pytest.mark.parametrize("synchronous", [False, True])
async def test_shared_embedding_failure_has_no_raw_provider_payload(
    monkeypatch, caplog, synchronous
):
    def fail(_texts):
        raise RuntimeError(PRIVATE)

    async def fail_async(texts):
        return fail(texts)

    monkeypatch.setattr(
        embedding,
        "_PROVIDER",
        SimpleNamespace(embed_texts=fail if synchronous else fail_async),
    )
    with pytest.raises(RuntimeError) as caught:
        await embedding.get_embeddings_async([PRIVATE])
    _assert_safe(caught.value, caplog)
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__
    assert "1 texts" in caplog.text


@pytest.mark.asyncio
async def test_provider_creation_failure_is_normalized(monkeypatch, caplog):
    def fail():
        raise RuntimeError(PRIVATE)

    monkeypatch.setattr(embedding, "_PROVIDER", None)
    monkeypatch.setattr(embedding, "get_default_provider", fail)
    with pytest.raises(RuntimeError) as caught:
        await embedding.get_embedding(PRIVATE)
    _assert_safe(caught.value, caplog)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["import", "load", "dimension", "encode"])
async def test_local_provider_failures_do_not_log_or_chain_raw_errors(
    monkeypatch, caplog, stage
):
    def fail(*_args, **_kwargs):
        raise RuntimeError(PRIVATE)

    if stage == "import":

        class MissingModule:
            __path__ = []

            def __getattr__(self, _name):
                return fail()

        monkeypatch.setitem(sys.modules, "sentence_transformers", MissingModule())
    else:
        model = SimpleNamespace(
            get_embedding_dimension=fail if stage == "dimension" else lambda: 3,
            encode=fail,
        )
        monkeypatch.setitem(
            sys.modules,
            "sentence_transformers",
            SimpleNamespace(
                SentenceTransformer=fail
                if stage == "load"
                else lambda *_args, **_kwargs: model
            ),
        )
    provider = local_provider.LocalEmbeddingProvider(model_name=PRIVATE)
    with pytest.raises(RuntimeError) as caught:
        await provider.embed_text(PRIVATE)
    _assert_safe(caught.value, caplog)


@pytest.mark.asyncio
async def test_local_success_reuses_model_and_preserves_encoding_options(monkeypatch):
    loads, calls = [], []

    class Row:
        def astype(self, dtype):
            assert dtype is float
            return self

        def tolist(self):
            return [0.1, 0.2, 0.3]

    def encode(texts, **options):
        calls.append((texts, options))
        return [Row() for _ in texts]

    model = SimpleNamespace(get_embedding_dimension=lambda: 3, encode=encode)

    def load(name, **options):
        loads.append((name, options))
        return model

    monkeypatch.setenv("LOCAL_EMBEDDING_BATCH_SIZE", "2")
    monkeypatch.setenv("LOCAL_EMBEDDING_NORMALIZE", "true")
    monkeypatch.setenv("LOCAL_EMBEDDING_LOCAL_FILES_ONLY", "true")
    monkeypatch.setitem(
        sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=load)
    )
    provider = local_provider.LocalEmbeddingProvider(model_name="test-model")
    assert await provider.embed_texts([]) == []
    assert loads == []
    await provider.warmup()
    assert await provider.embed_text("a") == [0.1, 0.2, 0.3]
    assert await provider.embed_texts(["b", "c"]) == [[0.1, 0.2, 0.3]] * 2
    assert loads == [("test-model", {"local_files_only": True})]
    assert calls[0][0] == ["a"]
    assert calls[1][0] == ["b", "c"]
    assert calls[0][1] == {
        "batch_size": 2,
        "show_progress_bar": False,
        "convert_to_numpy": True,
        "normalize_embeddings": True,
    }


@pytest.mark.asyncio
async def test_local_dimension_mismatch_is_explicit_without_model_path(
    monkeypatch, caplog
):
    monkeypatch.setitem(
        sys.modules,
        "sentence_transformers",
        SimpleNamespace(
            SentenceTransformer=lambda *_a, **_kw: SimpleNamespace(
                get_embedding_dimension=lambda: 7
            )
        ),
    )
    provider = local_provider.LocalEmbeddingProvider(model_name=PRIVATE)
    with pytest.raises(RuntimeError, match="outputs 7 dimensions") as caught:
        await provider.warmup()
    _assert_safe(caught.value, caplog)
    assert "model_dim=7 expected_dim=3" in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [400, 500, "connect", "timeout"])
@pytest.mark.parametrize("recover", [False, True])
async def test_real_httpx_embedding_errors_preserve_retry_without_disclosure(
    monkeypatch, caplog, failure, recover
):
    calls = []
    sleeps = []

    def respond(request: httpx.Request):
        calls.append(json.loads(request.content))
        if recover and len(calls) == 2:
            return httpx.Response(200, json={"data": [{"embedding": [0.1, 0.2, 0.3]}]})
        if failure == "connect":
            raise httpx.ConnectError(PRIVATE, request=request)
        if failure == "timeout":
            raise httpx.ReadTimeout(PRIVATE, request=request)
        return httpx.Response(failure, json={"error": {"message": PRIVATE}})

    async def sleep(delay):
        sleeps.append(delay)

    monkeypatch.setattr(openai_provider.asyncio, "sleep", sleep)
    provider = openai_provider.OpenAIEmbeddingProvider(api_key="test-only-placeholder")
    provider.base_url = f"https://embeddings.invalid/{PRIVATE}"
    await provider._client.aclose()
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    try:
        if recover and failure != 400:
            assert await provider.embed_text(PRIVATE) == [0.1, 0.2, 0.3]
            assert len(calls) == 2
            assert sleeps == [1.0]
        else:
            with pytest.raises(RuntimeError) as caught:
                await provider.embed_text(PRIVATE)
            _assert_safe(caught.value, caplog)
            assert caught.value.__cause__ is None
            assert len(calls) == (1 if failure == 400 else 4)
            assert sleeps == ([] if failure == 400 else [1.0, 2.0, 4.0, 8.0])
        assert PRIVATE not in caplog.text
        assert all(call["input"] == [PRIVATE] for call in calls)
        assert all(call["dimensions"] == 3 for call in calls)
    finally:
        await provider.close()


@pytest.mark.asyncio
async def test_remote_empty_input_makes_no_request():
    provider = openai_provider.OpenAIEmbeddingProvider(api_key="test-only-placeholder")
    await provider._client.aclose()

    def unexpected(_request):
        raise AssertionError("Empty input must not issue a provider request")

    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(unexpected))
    try:
        assert await provider.embed_text("") == []
        assert await provider.embed_texts([]) == []
    finally:
        await provider.close()


@pytest.mark.asyncio
async def test_rate_limit_recovery_and_batching_are_preserved(monkeypatch):
    calls, sleeps = [], []

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload["input"])
        if len(calls) == 1:
            return httpx.Response(429, json={"error": PRIVATE})
        return httpx.Response(
            200,
            json={"data": [{"embedding": [0.1, 0.2, 0.3]} for _ in payload["input"]]},
        )

    async def sleep(delay):
        sleeps.append(delay)

    monkeypatch.setattr(openai_provider.asyncio, "sleep", sleep)
    provider = openai_provider.OpenAIEmbeddingProvider(
        api_key="test-only-placeholder", batch_size=2
    )
    await provider._client.aclose()
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    try:
        assert await provider.embed_texts(["a", "b", "c"]) == [[0.1, 0.2, 0.3]] * 3
        assert calls == [["a", "b"], ["a", "b"], ["c"]]
        assert sleeps == [1.0]
    finally:
        await provider.close()


@pytest.mark.asyncio
async def test_shared_healthy_empty_dimension_and_cancellation_contracts(monkeypatch):
    provider = SimpleNamespace(embed_texts=AsyncMock(return_value=[[0.1, 0.2, 0.3]]))
    monkeypatch.setattr(embedding, "_PROVIDER", provider)
    assert await embedding.get_embeddings_async([]) == []
    provider.embed_texts.assert_not_awaited()
    assert await embedding.get_embedding("healthy") == [0.1, 0.2, 0.3]
    provider.embed_texts.return_value = [[0.1]]
    with pytest.raises(ValueError, match="dimension mismatch"):
        await embedding.get_embedding("wrong dimension")
    provider.embed_texts.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await embedding.get_embedding("cancelled")


@pytest.mark.asyncio
async def test_sync_embedding_adapter_preserves_safe_failure_in_running_loop(
    monkeypatch, caplog
):
    async def fail(_texts):
        raise RuntimeError(PRIVATE)

    monkeypatch.setattr(embedding, "_PROVIDER", SimpleNamespace(embed_texts=fail))
    with pytest.raises(RuntimeError) as caught:
        embedding.get_embedding_sync(PRIVATE)
    _assert_safe(caught.value, caplog)


class _UnusedStore(VectorStore):
    def add_embeddings(self, *args, **kwargs):
        raise AssertionError("No vectors may be written after embedding failure")

    def search(self, *args, **kwargs):
        raise AssertionError("No vector query may run after embedding failure")


@pytest.mark.asyncio
@pytest.mark.parametrize("consumer", ["semantic", "ingestion"])
async def test_real_consumers_keep_failure_explicit_without_private_tracebacks(
    monkeypatch, caplog, consumer
):
    monkeypatch.setattr(
        embedding,
        "_PROVIDER",
        SimpleNamespace(embed_texts=AsyncMock(side_effect=RuntimeError(PRIVATE))),
    )
    insert = AsyncMock()
    monkeypatch.setattr(ingestion, "insert_many", insert)
    with pytest.raises(RuntimeError) as caught:
        if consumer == "semantic":
            await SemanticSearch(_UnusedStore()).search(
                PRIVATE, user_id="user-1", workspace_id="workspace-1"
            )
        else:
            await ingestion.RAGIngestionPipeline(_UnusedStore()).ingest_text(
                PRIVATE, user_id="user-1", workspace_id="workspace-1"
            )
    _assert_safe(caught.value, caplog)
    insert.assert_not_awaited()
    if consumer == "semantic":
        assert isinstance(caught.value, RetrievalChannelError)
        assert caught.value.code == "embedding_unavailable"
    else:
        assert "embedding stage" in str(caught.value)
