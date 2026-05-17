import os

import pytest

os.environ["SUPABASE_URL"] = "http://localhost:8001"
os.environ["SUPABASE_ANON_KEY"] = "anon"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service"
os.environ["DEV_MODE"] = "false"
os.environ["MODEL_URL"] = "http://127.0.0.1:11434/v1/chat/completions"
os.environ["AI_MODEL"] = "phi3:latest"

from app.services import chat_service
from app.services.chat_service import AIMessage, AIGeneration, OllamaChatService


def test_build_payload_uses_phi3_and_preserves_context():
    service = OllamaChatService()

    payload = service._build_payload(
        "What changed?",
        context=[{"role": "assistant", "content": "The workspace was updated."}],
        temperature=0.1,
        stream=False,
    )

    assert payload["model"] == "phi3:latest"
    assert payload["temperature"] == 0.1
    assert payload["stream"] is False
    assert payload["messages"][0]["role"] == "system"
    assert payload["messages"][1] == {
        "role": "assistant",
        "content": "The workspace was updated.",
    }
    assert payload["messages"][-1] == {"role": "user", "content": "What changed?"}


def test_extract_content_supports_openai_compatible_response():
    content = OllamaChatService._extract_content(
        {"choices": [{"message": {"content": "Omnix is ready."}}]}
    )

    assert content == "Omnix is ready."


def test_parse_stream_line_supports_sse_delta_chunks():
    line = 'data: {"choices":[{"delta":{"content":"hello"}}]}'

    assert OllamaChatService._parse_stream_line(line) == "hello"


@pytest.mark.asyncio
async def test_call_llm_uses_service_abstraction(monkeypatch):
    class FakeService:
        async def generate(self, prompt, context=None, **kwargs):
            assert prompt == "Summarize this"
            assert context == [AIMessage(role="user", content="Prior context")]
            assert kwargs["model"] == "phi3:latest"
            return AIGeneration(content="Done", model="phi3:latest")

    monkeypatch.setattr(chat_service, "get_chat_service", lambda: FakeService())

    result = await chat_service.generate_ai_response(
        "Summarize this",
        context=[AIMessage(role="user", content="Prior context")],
        model="phi3:latest",
    )

    assert result.content == "Done"
