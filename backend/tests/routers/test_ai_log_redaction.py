from __future__ import annotations

import logging
from types import SimpleNamespace

from app.routers import messages
from app.services import chat_service


def test_message_prompt_debug_does_not_log_prompt_or_chunk_content(caplog) -> None:
    secret = "SECRET_DOCUMENT_PAYLOAD"
    caplog.set_level(logging.INFO, logger=messages.logger.name)

    messages._log_ollama_prompt_debug(
        conversation_id="conversation-1",
        prompt=f"DOCUMENT CONTEXT:\n{secret}",
        retrieval_debug={
            "strategy": "hybrid",
            "retrieved_chunks_count": 1,
            "first_chunk_preview": secret,
            "diagnostics": {
                "document_context_count": 1,
                "web_context_count": 0,
                "estimated_context_tokens": 42,
            },
        },
    )

    rendered = caplog.text
    assert secret not in rendered
    assert "prompt_preview" not in rendered
    assert "first_retrieved_chunk_preview" not in rendered
    assert "prompt_length" in rendered
    assert "has_first_retrieved_chunk=True" in rendered


def test_ollama_payload_logging_does_not_include_message_content(caplog) -> None:
    secret = "SECRET_PROMPT_PAYLOAD"
    service = object.__new__(chat_service.OllamaChatService)
    service.settings = SimpleNamespace(DEV_MODE=True)
    service.model_url = "http://localhost:11434/api/chat"
    service.default_model = "phi3:mini"
    service.system_prompt = "You are Omnix."
    service.max_output_tokens = 384
    service.max_context_messages = 4
    service.max_context_chars = 8000

    caplog.set_level(logging.DEBUG, logger=chat_service.logger.name)
    payload = service._build_payload(
        prompt=f"Summarize this: {secret}",
        context=[{"role": "assistant", "content": f"Prior context {secret}"}],
        stream=True,
    )

    assert secret in str(payload["messages"])
    rendered = caplog.text
    assert secret not in rendered
    assert "preview" not in rendered
    assert "messages_summary" in rendered
    assert "chars" in rendered
