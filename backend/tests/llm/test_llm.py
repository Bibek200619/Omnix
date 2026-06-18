import asyncio
import os

import pytest

os.environ["SUPABASE_URL"] = "http://localhost:8001"
os.environ["SUPABASE_ANON_KEY"] = "anon"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service"
os.environ["DEV_MODE"] = "false"
os.environ["MODEL_URL"] = "http://127.0.0.1:11434/v1/chat/completions"
os.environ["AI_MODEL"] = "phi3:mini"
os.environ["AI_MAX_OUTPUT_TOKENS"] = "384"
os.environ["AI_MAX_CONTEXT_MESSAGES"] = "4"

from app.routers import messages as messages_router
from app.schemas.chat import AIGenerationResponse
from app.services import chat_service
from app.services.chat_service import AIMessage, AIGeneration, OllamaChatService, ProviderManager


def test_build_payload_uses_phi3_and_preserves_context():
    service = OllamaChatService()

    payload = service._build_payload(
        "What changed?",
        context=[{"role": "assistant", "content": "The workspace was updated."}],
        temperature=0.1,
        stream=False,
    )

    assert service.model_url == "http://127.0.0.1:11434/api/chat"
    assert payload["model"] == "phi3:mini"
    assert payload["options"]["num_predict"] == 384
    assert payload["options"]["temperature"] == 0.1
    assert payload["stream"] is False
    assert payload["messages"][0]["role"] == "system"
    assert payload["messages"][1] == {
        "role": "assistant",
        "content": "The workspace was updated.",
    }
    assert payload["messages"][-1] == {"role": "user", "content": "What changed?"}


def test_build_payload_limits_history_to_recent_messages():
    service = OllamaChatService()
    context = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"message {index}"}
        for index in range(10)
    ]

    payload = service._build_payload("Continue", context=context)

    assert [message["content"] for message in payload["messages"][1:-1]] == [
        f"message {index}" for index in range(6, 10)
    ]


def test_build_payload_trims_context_by_token_budget_and_preserves_recent_tail():
    service = OllamaChatService()
    service.max_context_messages = 3
    service.max_context_tokens = 12

    payload = service._build_payload(
        "Continue",
        context=[
            {"role": "user", "content": "older context should be dropped"},
            {
                "role": "assistant",
                "content": "recent context one two three four five six seven eight nine ten eleven twelve",
            },
        ],
    )

    context_messages = payload["messages"][1:-1]
    assert len(context_messages) == 1
    assert context_messages[0]["role"] == "assistant"
    assert "older context" not in context_messages[0]["content"]
    assert "twelve" in context_messages[0]["content"]


def test_message_router_context_uses_token_budget(monkeypatch):
    class FakeSettings:
        AI_MAX_CONTEXT_MESSAGES = 4
        AI_MAX_CONTEXT_TOKENS = 128
        ollama_model = "phi3:mini"

    monkeypatch.setattr(messages_router, "get_settings", lambda: FakeSettings())
    oversized_newest = " ".join(["newest", *[f"token{index}" for index in range(180)]])

    context = messages_router._build_context(
        [
            {
                "role": "assistant",
                "content": oversized_newest,
                "status": "completed",
            },
            {"role": "user", "content": "older context should be dropped", "status": "completed"},
        ]
    )

    assert len(context) == 1
    assert context[0]["role"] == "assistant"
    assert "token179" in context[0]["content"]
    assert "older context" not in context[0]["content"]


def test_extract_content_supports_openai_compatible_response():
    content = OllamaChatService._extract_content(
        {"choices": [{"message": {"content": "Omnix is ready."}}]}
    )

    assert content == "Omnix is ready."


def test_parse_stream_line_supports_sse_delta_chunks():
    line = 'data: {"choices":[{"delta":{"content":"hello"}}]}'

    assert OllamaChatService._parse_stream_line(line) == "hello"


def test_parse_stream_line_supports_native_ollama_chunks():
    line = '{"message":{"role":"assistant","content":"native hello"},"done":false}'

    assert OllamaChatService._parse_stream_line(line) == "native hello"


@pytest.mark.asyncio
async def test_call_llm_uses_service_abstraction(monkeypatch):
    class FakeService:
        async def generate(self, prompt, context=None, **kwargs):
            assert prompt == "Summarize this"
            assert context == [AIMessage(role="user", content="Prior context")]
            assert kwargs["model"] == "phi3:mini"
            return AIGeneration(content="Done", model="phi3:mini")

    monkeypatch.setattr(chat_service, "get_chat_service", lambda: FakeService())

    result = await chat_service.generate_ai_response(
        "Summarize this",
        context=[AIMessage(role="user", content="Prior context")],
        model="phi3:mini",
    )

    assert result.content == "Done"


@pytest.mark.asyncio
async def test_provider_manager_fails_over_when_ollama_exceeds_latency_threshold():
    class SlowOllamaProvider:
        name = "ollama"

        async def generate(self, prompt, context=None, **kwargs):
            await asyncio.sleep(0.05)
            return AIGeneration(content="late", model="phi3:mini", provider="ollama")

    class FastOpenAIProvider:
        name = "openai"

        async def generate(self, prompt, context=None, **kwargs):
            return AIGeneration(content="fallback", model="gpt-4o-mini", provider="openai")

    manager = ProviderManager(
        providers={"ollama": SlowOllamaProvider(), "openai": FastOpenAIProvider()},
        provider_order=["ollama", "openai"],
        failover_latency_threshold=0.01,
        request_timeout=1.0,
    )

    generation = await manager.generate("Summarize this")

    assert generation.content == "fallback"
    assert generation.provider == "openai"


def test_ai_generation_response_accepts_cloud_provider_metadata():
    response = AIGenerationResponse(
        response="Done",
        model="gpt-4o-mini",
        provider="openai",
        usage={},
    )

    assert response.provider == "openai"
