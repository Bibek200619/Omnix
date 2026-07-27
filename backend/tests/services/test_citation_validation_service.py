from __future__ import annotations

import importlib

import pytest

from app.services.citation_validation_service import (
    finalize_generated_context_result,
    pending_citation_validation,
    validate_generated_citations,
)


def test_post_generation_validation_keeps_only_context_backed_labels() -> None:
    result = validate_generated_citations(
        "The release is ready [S1, S99], pending a final review [S2].",
        [{"label": "S1"}, {"label": "S2"}],
    )

    assert result.content == "The release is ready [S1], pending a final review [S2]."
    assert result.citations == ("S1", "S2")
    assert result.public_payload == {
        "status": "incomplete",
        "source_count": 2,
        "cited_source_count": 2,
        "invalid_citation_count": 1,
    }


def test_post_generation_validation_marks_missing_or_fabricated_evidence() -> None:
    missing = validate_generated_citations("The release is ready.", [{"label": "S1"}])
    fabricated = validate_generated_citations("The release is ready [S99].", [{"label": "S1"}])

    assert missing.content == "The release is ready."
    assert missing.status == "incomplete"
    assert fabricated.content == "The release is ready."
    assert fabricated.citations == ()
    assert fabricated.status == "unsupported"
    assert fabricated.invalid_citation_count == 1


def test_validation_uses_context_labels_and_leaves_code_examples_unchanged() -> None:
    result = validate_generated_citations(
        "Use [S1].\n\n```txt\n[S99]\n```\n\nAvoid [W1].",
        [{"label": "S1"}, {"label": "W1"}],
    )

    assert result.content == "Use [S1].\n\n```txt\n[S99]\n```\n\nAvoid."
    assert result.citations == ("S1",)
    assert result.status == "incomplete"
    assert result.invalid_citation_count == 1


def test_pending_validation_does_not_mark_retrieved_sources_as_citations() -> None:
    result = pending_citation_validation([{"label": "W1"}])

    assert result.citations == ()
    assert result.public_payload == {
        "status": "pending",
        "source_count": 1,
        "cited_source_count": 0,
        "invalid_citation_count": 0,
    }


def test_context_results_keep_only_sources_cited_in_the_final_output() -> None:
    result = finalize_generated_context_result(
        {
            "action": "workspace_summary",
            "markdown": "The release is ready [S1] but [S99] is not a source.",
            "structured_text": "The release is ready [S1] but [S99] is not a source.",
            "citations": [
                {"label": "S1", "source_id": "release-plan"},
                {"label": "S2", "source_id": "risk-register"},
            ],
        }
    )

    assert result["markdown"] == "The release is ready [S1] but is not a source."
    assert result["structured_text"] == result["markdown"]
    assert result["citations"] == [{"label": "S1", "source_id": "release-plan"}]
    assert result["citation_validation"] == {
        "status": "incomplete",
        "source_count": 2,
        "cited_source_count": 1,
        "invalid_citation_count": 1,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "module_name",
    [
        "app.actions.compare",
        "app.actions.faq",
        "app.actions.notes",
        "app.actions.summarize",
        "app.actions.tasks",
        "app.insights.action_item_detector",
        "app.insights.conflict_detector",
        "app.insights.topic_detection",
        "app.insights.workspace_summary",
    ],
)
async def test_context_backed_generators_finalize_their_citations(
    monkeypatch: pytest.MonkeyPatch,
    module_name: str,
) -> None:
    module = importlib.import_module(module_name)

    class FakeContextEngine:
        async def assemble(self, *_args: object, **_kwargs: object) -> dict[str, object]:
            return {
                "prompt": "Use only source labels.",
                "sources": [{"label": "S1", "source_id": "release-plan"}, {"label": "S2", "source_id": "risk-register"}],
            }

    async def fake_llm(*_args: object, **_kwargs: object) -> str:
        return "The release is ready [S1] and [S99]."

    monkeypatch.setattr(module, "call_llm", fake_llm)
    result = await module.run(FakeContextEngine(), "user-1", "workspace-1")

    assert result["markdown"] == "The release is ready [S1] and."
    assert result["citations"] == [{"label": "S1", "source_id": "release-plan"}]
    assert result["citation_validation"]["status"] == "incomplete"
