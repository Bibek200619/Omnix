import json
import os
import time

import httpx
import pytest

os.environ["SUPABASE_URL"] = "http://localhost:8001"
os.environ["SUPABASE_ANON_KEY"] = "anon"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service"
os.environ["DEV_MODE"] = "false"
os.environ["MODEL_URL"] = "http://127.0.0.1:11434/v1/chat/completions"
os.environ["AI_MODEL"] = "phi3:mini"
os.environ["AI_MAX_OUTPUT_TOKENS"] = "384"
os.environ["AI_MAX_CONTEXT_MESSAGES"] = "4"

from app.services import chat_service
from app.services.chat_service import AIMessage, AIGeneration, ModelServiceError, OllamaChatService
from app.services.llm.config import LLMSettings


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


def test_provider_framework_defaults_to_ollama(monkeypatch):
    monkeypatch.delenv("DEFAULT_PROVIDER", raising=False)

    settings = LLMSettings(_env_file=None)

    assert settings.DEFAULT_PROVIDER == "ollama"
    assert settings.FALLBACK_PROVIDER == "placeholder"


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


class MemoryRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def setex(self, key: str, _ttl: int, value: str):
        self.store[key] = value

    async def delete(self, key: str):
        self.store.pop(key, None)


class FailingClient:
    calls = 0

    def __init__(self, **kwargs) -> None:
        return None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url: str, json=None):
        FailingClient.calls += 1
        raise httpx.ConnectError("ollama down", request=httpx.Request("POST", url))


class SuccessfulResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self):
        return {"model": "phi3:mini", "message": {"content": "recovered"}, "done": True}


class SuccessfulClient:
    calls = 0

    def __init__(self, **kwargs) -> None:
        return None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url: str, json=None):
        SuccessfulClient.calls += 1
        return SuccessfulResponse()


@pytest.mark.asyncio
async def test_ollama_circuit_opens_after_three_failures(monkeypatch):
    redis = MemoryRedis()
    FailingClient.calls = 0
    monkeypatch.setattr(chat_service, "get_redis", lambda: redis, raising=False)
    monkeypatch.setattr(chat_service.httpx, "AsyncClient", FailingClient)
    service = OllamaChatService()
    service.max_retries = 0

    for _ in range(3):
        with pytest.raises(ModelServiceError):
            await service.generate("Hello")

    state = json.loads(redis.store["omnix:circuit:ollama"])
    assert state["state"] == "open"
    assert FailingClient.calls == 3

    with pytest.raises(ModelServiceError) as exc_info:
        await service.generate("Hello")

    assert exc_info.value.status_code == 503
    assert "retry in" in str(exc_info.value)
    assert FailingClient.calls == 3


@pytest.mark.asyncio
async def test_ollama_circuit_closes_after_successful_half_open_probe(monkeypatch):
    redis = MemoryRedis()
    SuccessfulClient.calls = 0
    redis.store["omnix:circuit:ollama"] = json.dumps(
        {"state": "open", "failures": 3, "opened_at": time.time() - 31}
    )
    monkeypatch.setattr(chat_service, "get_redis", lambda: redis, raising=False)
    monkeypatch.setattr(chat_service.httpx, "AsyncClient", SuccessfulClient)
    service = OllamaChatService()
    service.max_retries = 0

    result = await service.generate("Hello")

    assert result.content == "recovered"
    assert SuccessfulClient.calls == 1
    assert "omnix:circuit:ollama" not in redis.store
