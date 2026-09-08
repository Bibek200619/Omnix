from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.app.routers import messages
from backend.app.retrieval.context_builder import ContextBuilder
from backend.app.services.prompt_trust import BEGIN_UNTRUSTED_SOURCE_DATA
from backend.app.services.query_classifier import SearchDecision


@pytest.mark.asyncio
async def test_retrieval_blocks_document_prompt_during_processing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_uploaded_context(*args, **kwargs):
        return None

    async def fake_unavailable_documents(*args, **kwargs):
        return [
            {
                "id": "file-1",
                "file_name": "scan.pdf",
                "extraction_status": "processing",
                "extraction_failure_reason": None,
            }
        ]

    async def fail_has_documents(*args, **kwargs):
        raise AssertionError("retrieval should stop before hybrid document lookup")

    monkeypatch.setattr(messages, "build_uploaded_document_context", fake_uploaded_context)
    monkeypatch.setattr(messages, "find_unavailable_uploaded_documents", fake_unavailable_documents)
    monkeypatch.setattr(messages, "_has_retrievable_documents", fail_has_documents)

    prompt, sources, debug = await messages._retrieve_prompt_context(
        "Summarize this PDF",
        "user-1",
        "conversation-1",
        "workspace-1",
        [],
        "workspace",
        {"scope_workspace_ids": ["workspace-1"]},
    )

    assert sources == []
    assert debug["strategy"] == "document_unavailable"
    assert prompt == "I cannot summarize scan.pdf yet because text extraction has not completed."
    assert debug["diagnostics"]["unavailable_documents"][0]["extraction_status"] == "processing"


@pytest.mark.asyncio
async def test_short_workspace_question_uses_retrieval_when_documents_exist() -> None:
    calls: list[str] = []

    async def fake_web(*args, **kwargs):
        return (
            [],
            [],
            SearchDecision(
                requested_mode="auto",
                effective_mode="workspace",
                needs_web=False,
                confidence=0.0,
                reasons=["no_live_web_signal"],
            ),
            {},
        )

    async def fake_uploaded_context(*args, **kwargs):
        calls.append("uploaded_context")
        return SimpleNamespace(
            prompt="DOCUMENT CONTEXT:\nPricing changed to annual billing.",
            sources=[{"id": "chunk-1", "label": "S1"}],
            chunks=[{"content": "Pricing changed to annual billing."}],
            diagnostics={},
        )

    async def fake_has_documents(*args, **kwargs):
        calls.append("has_documents")
        return True

    prompt, sources, debug = await messages.message_retrieval_service.retrieve_prompt_context(
        "pricing?",
        "user-1",
        "conversation-1",
        "workspace-1",
        [],
        "auto",
        {"scope_workspace_ids": ["workspace-1"]},
        build_web_supplements_fn=fake_web,
        build_uploaded_document_context_fn=fake_uploaded_context,
        find_unavailable_uploaded_documents_fn=lambda **kwargs: None,
        has_retrievable_documents_fn=fake_has_documents,
    )

    assert calls == ["has_documents", "uploaded_context"]
    assert prompt.startswith("DOCUMENT CONTEXT")
    assert sources == [{"id": "chunk-1", "label": "S1"}]
    assert debug["strategy"] == "uploaded_document"


@pytest.mark.asyncio
async def test_short_greeting_still_skips_retrieval() -> None:
    async def fake_web(*args, **kwargs):
        return (
            [],
            [],
            SearchDecision(
                requested_mode="auto",
                effective_mode="workspace",
                needs_web=False,
                confidence=0.0,
                reasons=["no_live_web_signal"],
            ),
            {},
        )

    async def fail_uploaded_context(*args, **kwargs):
        raise AssertionError("small talk should not call retrieval")

    async def fail_has_documents(*args, **kwargs):
        raise AssertionError("small talk should not check document availability")

    prompt, sources, debug = await messages.message_retrieval_service.retrieve_prompt_context(
        "thanks",
        "user-1",
        "conversation-1",
        "workspace-1",
        [],
        "auto",
        {"scope_workspace_ids": ["workspace-1"]},
        build_web_supplements_fn=fake_web,
        build_uploaded_document_context_fn=fail_uploaded_context,
        find_unavailable_uploaded_documents_fn=lambda **kwargs: None,
        has_retrievable_documents_fn=fail_has_documents,
    )

    assert "CURRENT USER REQUEST (UNTRUSTED):" in prompt
    assert BEGIN_UNTRUSTED_SOURCE_DATA in prompt
    assert '"kind": "user_message"' in prompt
    assert "thanks" in prompt
    assert sources == []
    assert debug["strategy"] == "lightweight_prompt"


@pytest.mark.asyncio
async def test_hybrid_failure_returns_explicit_non_source_backed_response(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingHybridSearch:
        def __init__(self, *_args, **_kwargs) -> None:
            self.context_builder = ContextBuilder()

        async def search(self, *_args, **_kwargs):
            return SimpleNamespace(
                results=[],
                diagnostics={
                    "retrieval": {
                        "outcome": "failed",
                        "reason": "channel_timeout",
                        "failed_channels": ["semantic", "keyword"],
                    }
                },
            )

    async def fake_web(*args, **kwargs):
        return [], [], SearchDecision("workspace", "workspace", False, 0.0, ["workspace_only"]), {}

    async def no_uploaded_context(*args, **kwargs):
        return None

    async def no_unavailable_documents(*args, **kwargs):
        return []

    async def has_documents(*args, **kwargs):
        return True

    from backend.app.rag import startup
    from backend.app.retrieval import hybrid_search

    monkeypatch.setattr(startup, "get_vector_store", lambda: object())
    monkeypatch.setattr(hybrid_search, "HybridSearchEngine", FailingHybridSearch)

    prompt, sources, debug = await messages.message_retrieval_service.retrieve_prompt_context(
        "Summarize the workspace documents",
        "user-1",
        "conversation-1",
        "workspace-1",
        [],
        "workspace",
        {"scope_workspace_ids": ["workspace-1"]},
        build_web_supplements_fn=fake_web,
        build_uploaded_document_context_fn=no_uploaded_context,
        find_unavailable_uploaded_documents_fn=no_unavailable_documents,
        has_retrievable_documents_fn=has_documents,
    )

    assert prompt == messages.message_retrieval_service.retrieval_unavailable_answer()
    assert sources == []
    assert debug["strategy"] == "hybrid"
    assert debug["outcome"] == "failed"
    assert debug["reason"] == "channel_timeout"
    assert debug["failed_channels"] == ["semantic", "keyword"]


@pytest.mark.asyncio
async def test_hybrid_empty_context_is_not_reported_as_retrieval_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    class EmptyHybridSearch:
        def __init__(self, *_args, **_kwargs) -> None:
            self.context_builder = ContextBuilder()

        async def search(self, *_args, **_kwargs):
            return SimpleNamespace(
                results=[],
                diagnostics={
                    "retrieval": {
                        "outcome": "no_relevant_sources",
                        "reason": "no_matches",
                        "failed_channels": [],
                    }
                },
            )

    async def fake_web(*args, **kwargs):
        return [], [], SearchDecision("workspace", "workspace", False, 0.0, ["workspace_only"]), {}

    async def no_uploaded_context(*args, **kwargs):
        return None

    async def no_unavailable_documents(*args, **kwargs):
        return []

    async def has_documents(*args, **kwargs):
        return True

    from backend.app.rag import startup
    from backend.app.retrieval import hybrid_search

    monkeypatch.setattr(startup, "get_vector_store", lambda: object())
    monkeypatch.setattr(hybrid_search, "HybridSearchEngine", EmptyHybridSearch)

    prompt, sources, debug = await messages.message_retrieval_service.retrieve_prompt_context(
        "Summarize the workspace documents",
        "user-1",
        "conversation-1",
        "workspace-1",
        [],
        "workspace",
        {"scope_workspace_ids": ["workspace-1"]},
        build_web_supplements_fn=fake_web,
        build_uploaded_document_context_fn=no_uploaded_context,
        find_unavailable_uploaded_documents_fn=no_unavailable_documents,
        has_retrievable_documents_fn=has_documents,
    )

    assert "CURRENT USER REQUEST (UNTRUSTED):" in prompt
    assert sources == []
    assert debug["strategy"] == "hybrid"
    assert debug["outcome"] == "no_relevant_sources"
    assert debug["reason"] == "no_matches"
    assert debug["failed_channels"] == []
