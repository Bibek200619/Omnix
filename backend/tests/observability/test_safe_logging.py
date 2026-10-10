from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from backend.app.observability import safe_logging
from backend.app.observability.prompt_trace import PromptTrace
from backend.app.observability.retrieval_trace import RetrievalTrace


def _settings(*, env: str, dev_mode: bool) -> SimpleNamespace:
    return SimpleNamespace(ENV=env, DEV_MODE=dev_mode)


def test_safe_text_preview_redacts_sensitive_text_outside_development(monkeypatch) -> None:
    monkeypatch.setattr(safe_logging, "get_settings", lambda: _settings(env="production", dev_mode=True))

    preview = safe_logging.safe_text_preview("secret customer prompt about Project Helios", max_chars=12)

    assert preview.startswith("[redacted:")
    assert "Project Helios" not in preview
    assert safe_logging.allow_sensitive_logging() is False


def test_safe_text_preview_allows_explicit_development_logging(monkeypatch) -> None:
    monkeypatch.setattr(safe_logging, "get_settings", lambda: _settings(env="development", dev_mode=True))

    assert safe_logging.allow_sensitive_logging() is True
    assert safe_logging.safe_text_preview("secret customer prompt about Project Helios", max_chars=12) == "secret custo"


def test_safe_text_preview_preserves_existing_redaction_marker(monkeypatch) -> None:
    monkeypatch.setattr(safe_logging, "get_settings", lambda: _settings(env="production", dev_mode=False))

    assert safe_logging.safe_text_preview("[redacted:42 chars]") == "[redacted:42 chars]"


def test_prompt_trace_redacts_prompt_and_source_previews(monkeypatch) -> None:
    monkeypatch.setattr(safe_logging, "get_settings", lambda: _settings(env="production", dev_mode=False))

    trace = PromptTrace()
    trace.set_system_prompt("system prompt contains private workspace policy")
    trace.add_context("source-a", "source chunk says Project Helios acquisition timing")
    trace.add_memory("summary", "memory includes a confidential customer name")
    trace.set_final_messages([{"role": "user", "content": "final prompt asks for confidential details"}])

    snapshot = trace.get_snapshot()

    assert snapshot["system_prompt"].startswith("[redacted:")
    assert snapshot["context_preview"][0]["content_preview"].startswith("[redacted:")
    assert snapshot["memory_sections"][0]["content"].startswith("[redacted:")
    assert "Project Helios" not in str(snapshot)
    assert "confidential customer" not in str(snapshot)


def test_retrieval_trace_redacts_queries_and_chunk_previews(monkeypatch) -> None:
    monkeypatch.setattr(safe_logging, "get_settings", lambda: _settings(env="production", dev_mode=False))

    trace = RetrievalTrace()
    trace.add_query("Find Project Helios acquisition notes")
    trace.add_result(
        "chunk-1",
        0.92,
        "Project Helios source chunk includes confidential customer evidence",
        rank=1,
    )

    snapshot = trace.get_snapshot()

    assert snapshot["queries"][0]["query"].startswith("[redacted:")
    assert snapshot["results"][0]["preview"].startswith("[redacted:")
    assert "Project Helios" not in str(snapshot)
    assert "confidential customer" not in str(snapshot)


def test_chat_logging_redacts_prompt_and_error_previews() -> None:
    path = Path("backend/app/services/chat_service.py")
    if not path.exists():
        path = Path("app/services/chat_service.py")
    chat_service = path.read_text()

    assert '(prompt or "")[:500]' not in chat_service
    assert "exc.response.text[:500]" not in chat_service
    assert "safe_text_preview(prompt" in chat_service
    assert "safe_text_preview(exc.response.text" in chat_service
