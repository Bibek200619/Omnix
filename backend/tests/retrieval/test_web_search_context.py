from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:8001")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service")

from backend.app.retrieval.context_builder import ContextBuilder, ContextSupplement
from backend.app.settings import get_settings
from backend.app.services.chat_service import OllamaChatService
from backend.app.services.query_classifier import classify_search_need
from backend.app.services.web_search import TavilySearchService


def test_query_classifier_detects_current_web_need() -> None:
    decision = classify_search_need("What are the latest AI search trends in 2026?")

    assert decision.needs_web is True
    assert decision.effective_mode == "hybrid"
    assert "current_time_sensitive_terms" in decision.reasons


def test_query_classifier_detects_live_sports_queries() -> None:
    decision = classify_search_need("Latest Manchester City Premier League match score")

    assert decision.needs_web is True
    assert decision.effective_mode == "hybrid"
    assert "volatile_topic" in decision.reasons


def test_query_classifier_respects_workspace_mode() -> None:
    decision = classify_search_need("latest roadmap in our uploaded docs", "workspace")

    assert decision.needs_web is False
    assert decision.effective_mode == "workspace"


def test_context_builder_accepts_web_supplements() -> None:
    builder = ContextBuilder(max_chunks=2, token_budget=260, max_chunk_tokens=120)
    supplement = ContextSupplement(
        content="Title: Omnix research\nURL: https://example.com/research\nContent: Live web context.",
        title="Omnix research",
        source_type="web",
        source_id="https://example.com/research",
        workspace_id="workspace-a",
        score=0.9,
        metadata={"url": "https://example.com/research", "domain": "example.com"},
    )

    built = builder.build(
        "latest Omnix research",
        [],
        workspace_id="workspace-a",
        supplemental_contexts=[supplement],
    )

    assert "WEB SEARCH RESULTS" in built.prompt
    assert "\n\nDOCUMENT CONTEXT:" not in built.prompt
    assert "Live web context" in built.prompt
    assert built.sources[0]["type"] == "web"
    assert built.sources[0]["url"] == "https://example.com/research"
    assert built.sources[0]["domain"] == "example.com"


def test_ollama_payload_contains_explicit_web_context() -> None:
    builder = ContextBuilder(max_chunks=2, token_budget=900, max_chunk_tokens=300)
    supplement = ContextSupplement(
        content=(
            "Title: Manchester City 3-1 Bournemouth\n"
            "URL: https://example.com/match\n"
            "Content: Manchester City beat Bournemouth 3-1 in their latest Premier League match."
        ),
        title="Manchester City 3-1 Bournemouth",
        source_type="web",
        source_id="https://example.com/match",
        score=0.98,
        metadata={
            "url": "https://example.com/match",
            "domain": "example.com",
            "snippet": "Manchester City beat Bournemouth 3-1 in their latest Premier League match.",
        },
    )

    built = builder.build(
        "Latest Manchester City Premier League match score",
        [],
        supplemental_contexts=[supplement],
    )
    payload = OllamaChatService()._build_payload(built.prompt, context=[], stream=True)
    final_user_message = payload["messages"][-1]["content"]

    assert "WEB SEARCH RESULTS:" in final_user_message
    assert "Manchester City beat Bournemouth 3-1" in final_user_message
    assert "If WEB SEARCH RESULTS are present, do not say you lack live/current access" in final_user_message


def test_tavily_parser_sanitizes_and_deduplicates_results(monkeypatch) -> None:
    monkeypatch.setenv("WEB_SEARCH_ENABLED", "true")
    monkeypatch.setenv("TAVILY_API_KEY", "test-key")
    get_settings.cache_clear()
    service = TavilySearchService()
    get_settings.cache_clear()

    results = service._parse_results(
        [
            {"title": " Result\nOne ", "url": "https://example.com/a", "content": " Fresh\nsnippet ", "score": 0.7},
            {"title": "Duplicate", "url": "https://example.com/a", "content": "Duplicate"},
            {"title": "Bad", "url": "javascript:alert(1)", "content": "Nope"},
        ],
        limit=5,
    )

    assert len(results) == 1
    assert results[0].title == "Result One"
    assert results[0].domain == "example.com"
    assert results[0].snippet == "Fresh snippet"
