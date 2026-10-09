from __future__ import annotations

import json
import logging
import traceback
from types import SimpleNamespace
from typing import Any

import pytest
from starlette.requests import Request

from app.rag import startup
from app.retrieval import hybrid_search
from app.retrieval.context_builder import ContextBuilder, ContextSupplement
from app.retrieval.scoring import RetrievalResult
from app.routers import messages
from app.services import document_context_service as docs
from app.services import message_retrieval_service as retrieval
from app.services.query_classifier import SearchDecision
from app.services.retrieval_state import (
    public_retrieval_payload,
    should_bypass_model_for_retrieval,
)
from app.services.supabase_service import SupabaseServiceError

PRIVATE_ERROR = "private-provider-detail-and-document-text"
QUERY = "Explain the uploaded document"


class ReadBoundary:
    """Normalized database read double; the builder and chat retrieval stay real."""

    def __init__(self, workspace_id: str | None, failure: str | None = None) -> None:
        self.failure = failure
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.files = [
            {
                "id": "file-1",
                "user_id": "user-1",
                "workspace_id": workspace_id,
                "file_name": "release.txt",
                "extraction_status": "searchable",
            }
        ]
        self.chunks = [
            {
                "id": "chunk-1",
                "file_id": "file-1",
                "user_id": "user-1",
                "workspace_id": workspace_id,
                "content": "The release ships on Friday.",
                "chunk_index": 0,
            }
        ]

    async def select(
        self, table: str, _columns: str, *, filters: dict[str, Any], **_kwargs: Any
    ) -> list[dict[str, Any]]:
        self.calls.append((table, filters))
        if self.failure == table:
            try:
                raise TimeoutError(PRIVATE_ERROR)
            except TimeoutError as exc:
                raise SupabaseServiceError("Database read unavailable") from exc
        return self.files if table == "files" else self.chunks

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(docs, "select_all", self.select)
        monkeypatch.setattr(docs, "select_all_trusted", self.select)


async def build(workspace_id: str | None) -> Any:
    return await docs.build_uploaded_document_context(
        QUERY,
        user_id="user-1",
        conversation_id="conversation-1",
        workspace_id=workspace_id,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_id", [None, "workspace-1"])
@pytest.mark.parametrize("failure", ["files", "documents"])
async def test_real_builder_surfaces_failed_reads_without_private_causes(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    workspace_id: str | None,
    failure: str,
) -> None:
    reader = ReadBoundary(workspace_id, failure)
    reader.install(monkeypatch)
    with (
        caplog.at_level(logging.WARNING),
        pytest.raises(SupabaseServiceError) as caught,
    ):
        await build(workspace_id)
    assert PRIVATE_ERROR not in "".join(traceback.format_exception(caught.value))
    assert PRIVATE_ERROR not in caplog.text
    assert [table for table, _ in reader.calls] == (
        ["files"] if failure == "files" else ["files", "documents"]
    )
    assert "unavailable" in str(caught.value).lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_id", [None, "workspace-1"])
async def test_availability_lookup_does_not_report_a_failed_file_read_as_no_uploads(
    monkeypatch: pytest.MonkeyPatch,
    workspace_id: str | None,
) -> None:
    reader = ReadBoundary(workspace_id, "files")
    reader.install(monkeypatch)
    with pytest.raises(SupabaseServiceError):
        await docs.find_unavailable_uploaded_documents(
            user_id="user-1",
            conversation_id="conversation-1",
            workspace_id=workspace_id,
        )
    assert (
        len(reader.calls) == 1
    )  # Failed conversation lookup must not become a broad fallback.


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_id", [None, "workspace-1"])
async def test_failed_scope_fallback_after_empty_conversation_remains_explicit(
    monkeypatch: pytest.MonkeyPatch,
    workspace_id: str | None,
) -> None:
    calls: list[dict[str, Any]] = []

    async def select(
        _table: str, _columns: str, *, filters: dict[str, Any], **_kwargs: Any
    ) -> Any:
        calls.append(filters)
        if "conversation_id" in filters:
            return []
        raise SupabaseServiceError("Database read unavailable")

    monkeypatch.setattr(docs, "select_all", select)
    monkeypatch.setattr(docs, "select_all_trusted", select)
    with pytest.raises(SupabaseServiceError):
        await build(workspace_id)
    assert len(calls) == 2
    assert calls[1] == (
        {"workspace_id": [workspace_id]} if workspace_id else {"user_id": "user-1"}
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_id", [None, "workspace-1"])
@pytest.mark.parametrize("failure", ["files", "documents"])
async def test_failed_read_can_recover_on_the_next_request(
    monkeypatch: pytest.MonkeyPatch,
    workspace_id: str | None,
    failure: str,
) -> None:
    reader = ReadBoundary(workspace_id, failure)
    reader.install(monkeypatch)
    with pytest.raises(SupabaseServiceError):
        await build(workspace_id)
    reader.failure = None
    context = await build(workspace_id)
    assert context is not None
    assert context.sources[0]["file_id"] == "file-1"
    assert "Friday" in context.prompt


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_id", [None, "workspace-1"])
@pytest.mark.parametrize("empty", ["files", "documents", "matches"])
async def test_successful_empty_reads_and_no_matches_remain_valid(
    monkeypatch: pytest.MonkeyPatch,
    workspace_id: str | None,
    empty: str,
) -> None:
    reader = ReadBoundary(workspace_id)
    if empty == "files":
        reader.files = []
    elif empty == "documents":
        reader.chunks = []
    reader.install(monkeypatch)
    context = await docs.build_uploaded_document_context(
        "astronomy galaxy nebula" if empty == "matches" else QUERY,
        user_id="user-1",
        conversation_id="conversation-1",
        workspace_id=workspace_id,
    )
    assert context is None
    if empty == "files":
        assert reader.calls == [
            (
                "files",
                {
                    **(
                        {"workspace_id": [workspace_id]}
                        if workspace_id
                        else {"user_id": "user-1"}
                    ),
                    "conversation_id": "conversation-1",
                },
            ),
            (
                "files",
                {"workspace_id": [workspace_id]}
                if workspace_id
                else {"user_id": "user-1"},
            ),
        ]


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_id", [None, "workspace-1"])
async def test_recovered_results_still_enforce_scope(
    monkeypatch: pytest.MonkeyPatch,
    workspace_id: str | None,
) -> None:
    reader = ReadBoundary(workspace_id)
    reader.files.append(
        {**reader.files[0], "id": "other-file", "workspace_id": "other-workspace"}
    )
    reader.chunks.append(
        {
            **reader.chunks[0],
            "id": "other-chunk",
            "file_id": "other-file",
            "workspace_id": "other-workspace",
            "content": "private-other-scope",
        }
    )
    reader.chunks.append(
        {
            **reader.chunks[0],
            "id": "other-user-chunk",
            "user_id": "other-user",
            "workspace_id": None,
            "content": "private-other-user",
        }
    )
    reader.install(monkeypatch)
    context = await build(workspace_id)
    assert context is not None
    assert [source["file_id"] for source in context.sources] == ["file-1"]
    assert "private-other" not in context.prompt
    assert reader.calls[1][1] == {
        "file_id": ["file-1"],
        **({"workspace_id": [workspace_id]} if workspace_id else {"user_id": "user-1"}),
    }


async def no_web(*_args: Any, **_kwargs: Any) -> Any:
    return (
        [],
        [],
        SearchDecision("workspace", "workspace", False, 1.0, ["workspace_only"]),
        {},
    )


async def no_documents(**_kwargs: Any) -> bool:
    return False


async def retrieve(*, fallback: str = "none", message: str = QUERY) -> Any:
    async def web(*_args: Any, **_kwargs: Any) -> Any:
        supplements = (
            [
                ContextSupplement(
                    content="Public release guidance.",
                    title="Release guidance",
                    source_type="web",
                    source_id="https://example.com/release",
                    workspace_id="workspace-1",
                    score=1.0,
                )
            ]
            if fallback == "web"
            else []
        )
        return (
            supplements,
            [],
            SearchDecision(
                "auto",
                "hybrid" if supplements else "workspace",
                bool(supplements),
                1.0,
                [],
            ),
            {},
        )

    async def availability(**_kwargs: Any) -> bool:
        return fallback in {"hybrid", "hybrid_empty"}

    return await retrieval.retrieve_prompt_context(
        message,
        "user-1",
        "conversation-1",
        "workspace-1",
        ["file-1"],
        "auto",
        None,
        build_web_supplements_fn=web,
        has_retrievable_documents_fn=availability,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["files", "documents"])
@pytest.mark.parametrize("fallback", ["none", "web", "hybrid", "hybrid_empty"])
async def test_real_uploaded_failure_reaches_consumer_coverage_and_model_policy(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    failure: str,
    fallback: str,
) -> None:
    reader = ReadBoundary("workspace-1", failure)
    reader.install(monkeypatch)

    class Hybrid:
        def __init__(self, *_args: Any) -> None:
            self.context_builder = ContextBuilder()

        async def search(self, *_args: Any, **_kwargs: Any) -> Any:
            results = (
                [
                    RetrievalResult(
                        chunk_id="hybrid-chunk",
                        content="A verified fallback release fact.",
                        file_id="file-1",
                        file_name="release.txt",
                        workspace_id="workspace-1",
                        score=1.0,
                        sources={"keyword"},
                    )
                ]
                if fallback == "hybrid"
                else []
            )
            return SimpleNamespace(
                results=results,
                diagnostics={
                    "retrieval": {
                        "outcome": "sources_found"
                        if results
                        else "no_relevant_sources",
                        "failed_channels": [],
                    }
                },
            )

    monkeypatch.setattr(startup, "get_vector_store", lambda: object())
    monkeypatch.setattr(hybrid_search, "HybridSearchEngine", Hybrid)
    # No document-intent phrase: exercise the primary failure flag through each fallback branch.
    with caplog.at_level(logging.WARNING):
        prompt, sources, debug = await retrieve(
            fallback=fallback, message="Explain Friday's release"
        )
    partial = fallback in {"web", "hybrid"}
    assert debug["outcome"] == ("partial" if partial else "failed")
    assert debug["failed_channels"] == ["uploaded_document"]
    assert bool(sources) == partial
    assert should_bypass_model_for_retrieval(debug) is (not partial)
    if partial:
        assert "Some retrieval channels were unavailable" in prompt
    else:
        assert prompt == retrieval.retrieval_unavailable_answer()
    assert PRIVATE_ERROR not in repr((prompt, sources, debug))
    assert PRIVATE_ERROR not in caplog.text
    assert public_retrieval_payload(debug, sources)["outcome"] == debug["outcome"]


@pytest.mark.asyncio
async def test_document_intent_reports_failed_availability_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reader = ReadBoundary("workspace-1", "files")
    reader.install(monkeypatch)
    prompt, sources, debug = await retrieve()
    assert prompt == retrieval.retrieval_unavailable_answer()
    assert sources == []
    assert debug["outcome"] == "failed"
    assert debug["reason"] == "availability_unavailable"
    assert debug["failed_channels"] == ["uploaded_document"]


@pytest.mark.asyncio
async def test_successful_processing_lookup_keeps_explicit_source_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reader = ReadBoundary("workspace-1")
    reader.files[0]["extraction_status"] = "processing"
    reader.chunks = []
    reader.install(monkeypatch)
    prompt, sources, debug = await retrieve()
    assert "extraction has not completed" in prompt
    assert sources == []
    assert debug["outcome"] == "source_unavailable"
    assert should_bypass_model_for_retrieval(debug)


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_both_chat_routes_bypass_model_after_real_uploaded_read_failure(
    monkeypatch: pytest.MonkeyPatch,
    stream: bool,
) -> None:
    reader = ReadBoundary(None, "documents")
    reader.install(monkeypatch)
    writes: list[dict[str, Any]] = []
    model_calls: list[str] = []

    async def no_op(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def insert_conversation(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"id": "conversation-1", "user_id": "user-1"}

    async def insert_messages(
        _table: str, rows: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        return [{**row, "id": f"message-{index}"} for index, row in enumerate(rows)]

    async def update(**kwargs: Any) -> dict[str, Any]:
        writes.append(kwargs)
        return {
            "id": kwargs["assistant_message_id"],
            "conversation_id": "conversation-1",
            "user_id": "user-1",
            "role": "assistant",
            "content": kwargs["content"],
            "status": kwargs["status_value"],
        }

    async def hydrate(rows: list[dict[str, Any]], *_args: Any) -> list[dict[str, Any]]:
        return rows

    async def model(*_args: Any, **_kwargs: Any) -> str:
        model_calls.append("chat")
        return "Unverified answer"

    async def model_stream(*_args: Any, **_kwargs: Any):
        model_calls.append("stream")
        yield "Unverified answer"

    async def actual_retrieval(*args: Any) -> Any:
        return await retrieval.retrieve_prompt_context(
            *args,
            build_web_supplements_fn=no_web,
            has_retrievable_documents_fn=no_documents,
        )

    for name in [
        "require_active_workspace_access",
        "_check_rate_limit",
        "_attach_files_to_conversation",
        "_load_workspace_intelligence_for_chat",
        "_persist_assistant_payload",
        "_touch_conversation",
        "log_workspace_activity",
    ]:
        monkeypatch.setattr(messages, name, no_op)
    monkeypatch.setattr(messages, "insert_one", insert_conversation)
    monkeypatch.setattr(messages, "insert_many", insert_messages)
    monkeypatch.setattr(messages, "_retrieve_prompt_context", actual_retrieval)
    monkeypatch.setattr(messages, "_update_assistant_message", update)
    monkeypatch.setattr(messages, "hydrate_conversation_history", hydrate)
    monkeypatch.setattr(messages, "_log_ollama_prompt_debug", lambda **_kwargs: None)
    monkeypatch.setattr(messages, "call_llm", model)
    monkeypatch.setattr(messages, "call_llm_stream", model_stream)

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    request = Request(
        {"type": "http", "method": "POST", "path": "/chat", "headers": []},
        receive=receive,
    )
    payload = messages.ChatRequest(
        message="Explain Friday's release",
        attachment_ids=["file-1"],
        search_mode="workspace",
    )
    if stream:
        response = await messages.chat_stream(
            request=request, payload=payload, current_user={"sub": "user-1"}
        )
        events = []
        async for chunk in response.body_iterator:
            events.extend(
                json.loads(line[6:])
                for line in str(chunk).splitlines()
                if line.startswith("data: ")
            )
        assert any(
            event.get("retrieval", {}).get("outcome") == "failed"
            for event in events
            if isinstance(event.get("retrieval"), dict)
        )
        assert (
            "".join(event["text"] for event in events if event["type"] == "token")
            == retrieval.retrieval_unavailable_answer()
        )
    else:
        response = await messages.chat(
            request=request, payload=payload, current_user={"sub": "user-1"}
        )
        assert response.response == retrieval.retrieval_unavailable_answer()
        assert response.retrieval["outcome"] == "failed"
    assert model_calls == []
    assert writes[-1]["retrieval_debug"]["failed_channels"] == ["uploaded_document"]
    assert writes[-1]["content"] == retrieval.retrieval_unavailable_answer()
