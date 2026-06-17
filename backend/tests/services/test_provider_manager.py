from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from app.services.chat_service import AIGeneration, AIMessage
from app.services.provider_manager import ProviderManager


@dataclass
class FakeSettings:
    AI_PROVIDER: str = "auto"
    AI_SYSTEM_PROMPT: str = "System prompt"
    AI_REQUEST_TIMEOUT_SECONDS: float = 30.0
    AI_STREAM_TIMEOUT_SECONDS: float = 30.0
    AI_MAX_CONTEXT_MESSAGES: int = 20
    AI_MAX_CONTEXT_CHARS: int = 16000
    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MAX_OUTPUT_TOKENS: int = 4096
    ANTHROPIC_API_KEY: str | None = None
    ANTHROPIC_MODEL: str = "claude-3-5-haiku-latest"
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com/v1"
    ANTHROPIC_MAX_OUTPUT_TOKENS: int = 4096
    OLLAMA_MAX_OUTPUT_TOKENS: int = 2048


class FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._payload


class RecordingClient:
    def __init__(self, calls: list[dict[str, Any]], response_payload: dict[str, Any], **_: Any) -> None:
        self.calls = calls
        self.response_payload = response_payload

    async def __aenter__(self) -> "RecordingClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return FakeResponse(self.response_payload)


class FakeOllama:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def generate(self, prompt: str, context: list[dict[str, str] | AIMessage] | None = None, **kwargs: Any) -> AIGeneration:
        self.calls.append({"prompt": prompt, "context": context, **kwargs})
        return AIGeneration(content="local", model="phi3:mini", provider="ollama")


@pytest.mark.asyncio
async def test_provider_manager_routes_to_openai_when_key_is_present() -> None:
    calls: list[dict[str, Any]] = []
    settings = FakeSettings(OPENAI_API_KEY="sk-test")

    manager = ProviderManager(
        settings=settings,
        http_client_factory=lambda **kwargs: RecordingClient(
            calls,
            {
                "model": "gpt-4o-mini",
                "choices": [{"message": {"content": "remote"}}],
                "usage": {"total_tokens": 12},
            },
            **kwargs,
        ),
    )

    result = await manager.generate("Hello", max_tokens=9000)

    assert result.provider == "openai"
    assert result.content == "remote"
    assert calls[0]["url"] == "https://api.openai.com/v1/chat/completions"
    assert calls[0]["json"]["model"] == "gpt-4o-mini"
    assert calls[0]["json"]["max_tokens"] == 4096


@pytest.mark.asyncio
async def test_provider_manager_routes_to_anthropic_when_openai_key_is_absent() -> None:
    calls: list[dict[str, Any]] = []
    settings = FakeSettings(ANTHROPIC_API_KEY="anthropic-test")

    manager = ProviderManager(
        settings=settings,
        http_client_factory=lambda **kwargs: RecordingClient(
            calls,
            {
                "model": "claude-3-5-haiku-latest",
                "content": [{"type": "text", "text": "claude"}],
                "usage": {"input_tokens": 3, "output_tokens": 2},
            },
            **kwargs,
        ),
    )

    result = await manager.generate("Hello")

    assert result.provider == "anthropic"
    assert result.content == "claude"
    assert calls[0]["url"] == "https://api.anthropic.com/v1/messages"
    assert calls[0]["json"]["model"] == "claude-3-5-haiku-latest"
    assert calls[0]["json"]["max_tokens"] == 4096


@pytest.mark.asyncio
async def test_provider_manager_falls_back_to_ollama_with_provider_token_cap() -> None:
    ollama = FakeOllama()
    manager = ProviderManager(settings=FakeSettings(), ollama_service=ollama)

    result = await manager.generate("Hello", max_tokens=9000)

    assert result.provider == "ollama"
    assert ollama.calls[0]["max_tokens"] == 2048


def test_provider_manager_uses_twenty_message_context_window() -> None:
    manager = ProviderManager(settings=FakeSettings(), ollama_service=FakeOllama())
    context = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"message {index}"}
        for index in range(25)
    ]

    messages = manager._build_messages("Continue", context)

    assert [message["content"] for message in messages[1:-1]] == [
        f"message {index}" for index in range(5, 25)
    ]
