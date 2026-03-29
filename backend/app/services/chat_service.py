from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Literal

import httpx
from fastapi import status

from ..core.config import get_settings

logger = logging.getLogger(__name__)

MessageRole = Literal["system", "user", "assistant"]


@dataclass(frozen=True)
class AIMessage:
    role: MessageRole
    content: str


@dataclass(frozen=True)
class AIGeneration:
    content: str
    model: str
    provider: str = "ollama"
    usage: dict[str, Any] = field(default_factory=dict)


class ModelServiceError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
    ):
        super().__init__(message)
        self.status_code = status_code


class OllamaChatService:
    """Async Ollama chat client using the OpenAI-compatible API surface."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.model_url = self.settings.MODEL_URL
        self.default_model = self.settings.AI_MODEL or self.settings.OLLAMA_DEFAULT_MODEL
        self.system_prompt = self.settings.AI_SYSTEM_PROMPT
        self.request_timeout = self.settings.AI_REQUEST_TIMEOUT_SECONDS
        self.stream_timeout = self.settings.AI_STREAM_TIMEOUT_SECONDS
        self.max_retries = max(0, self.settings.AI_MAX_RETRIES)
        self.max_output_tokens = self.settings.AI_MAX_OUTPUT_TOKENS
        self.max_context_messages = self.settings.AI_MAX_CONTEXT_MESSAGES
        self.max_context_chars = self.settings.AI_MAX_CONTEXT_CHARS

    def _normalize_context(
        self,
        context: list[dict[str, str] | AIMessage] | None,
    ) -> list[AIMessage]:
        if not context:
            return []

        normalized: list[AIMessage] = []
        total_chars = 0

        for item in context[-self.max_context_messages :]:
            role = item.role if isinstance(item, AIMessage) else item.get("role")
            content = item.content if isinstance(item, AIMessage) else item.get("content")

            if role not in ("system", "user", "assistant"):
                continue
            if not isinstance(content, str):
                continue

            clean_content = content.strip()
            if not clean_content:
                continue

            if total_chars + len(clean_content) > self.max_context_chars:
                break

            normalized.append(AIMessage(role=role, content=clean_content))
            total_chars += len(clean_content)

        return normalized

    def _build_messages(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None = None,
        system_prompt: str | None = None,
    ) -> list[dict[str, str]]:
        messages: list[AIMessage] = []
        effective_system_prompt = (system_prompt or self.system_prompt).strip()
        if effective_system_prompt:
            messages.append(AIMessage(role="system", content=effective_system_prompt))

        messages.extend(self._normalize_context(context))
        messages.append(AIMessage(role="user", content=prompt.strip()))

        return [{"role": message.role, "content": message.content} for message in messages]

    def _build_payload(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None = None,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        model: str | None = None,
        max_tokens: int | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        payload = {
            "model": model or self.default_model,
            "messages": self._build_messages(prompt, context, system_prompt),
            "temperature": temperature,
            "max_tokens": max_tokens or self.max_output_tokens,
            "stream": stream,
        }
        logger.info(
            "Prepared Ollama request: model=%s stream=%s messages=%d final_user_prompt_length=%d",
            payload["model"],
            stream,
            len(payload["messages"]),
            len(prompt or ""),
        )
        logger.debug("Ollama final user prompt preview: %r", (prompt or "")[:500])
        return payload

    @staticmethod
    def _extract_content(payload: dict[str, Any]) -> str:
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"]

        message = payload.get("message")
        if isinstance(message, dict) and isinstance(message.get("content"), str):
            return message["content"]

        response = payload.get("response")
        if isinstance(response, str):
            return response

        raise ModelServiceError(
            "Model service returned an invalid response.",
            status.HTTP_502_BAD_GATEWAY,
        )

    async def generate(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None = None,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> AIGeneration:
        payload = self._build_payload(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=max_tokens,
            stream=False,
        )

        last_error: Exception | None = None
        timeout = httpx.Timeout(self.request_timeout, connect=10.0)

        for attempt in range(self.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(self.model_url, json=payload)
                    response.raise_for_status()
                    data = response.json()

                return AIGeneration(
                    content=self._extract_content(data),
                    model=str(data.get("model") or payload["model"]),
                    usage={
                        "prompt_tokens": data.get("prompt_eval_count"),
                        "completion_tokens": data.get("eval_count"),
                        "total_duration": data.get("total_duration"),
                    },
                )
            except httpx.TimeoutException as exc:
                last_error = exc
                logger.warning("Ollama request timed out on attempt %s.", attempt + 1)
            except httpx.HTTPStatusError as exc:
                last_error = exc
                status_code = exc.response.status_code
                if 400 <= status_code < 500:
                    logger.warning("Ollama rejected request with HTTP %s.", status_code)
                    raise ModelServiceError(
                        "Model service rejected the request.",
                        status.HTTP_502_BAD_GATEWAY,
                    ) from exc
                logger.warning("Ollama HTTP %s on attempt %s.", status_code, attempt + 1)
            except (httpx.RequestError, json.JSONDecodeError, ModelServiceError) as exc:
                last_error = exc
                logger.warning("Ollama generation failed on attempt %s: %s", attempt + 1, exc)

            if attempt < self.max_retries:
                await asyncio.sleep(0.25 * (2**attempt))

        raise ModelServiceError(
            "Model service unavailable. Ensure Ollama is running and gemma:2b is installed.",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        ) from last_error

    async def stream(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None = None,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        payload = self._build_payload(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=max_tokens,
            stream=True,
        )
        timeout = httpx.Timeout(self.stream_timeout, connect=10.0)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", self.model_url, json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        token = self._parse_stream_line(line)
                        if token:
                            yield token
        except httpx.TimeoutException as exc:
            logger.warning("Ollama stream timed out.")
            raise ModelServiceError(
                "Model stream timed out.",
                status.HTTP_504_GATEWAY_TIMEOUT,
            ) from exc
        except httpx.HTTPError as exc:
            logger.warning("Ollama stream failed: %s", exc)
            raise ModelServiceError(
                "Model service unavailable. Ensure Ollama is running and gemma:2b is installed.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            ) from exc

    @staticmethod
    def _parse_stream_line(line: str) -> str:
        if not line:
            return ""

        data = line.removeprefix("data:").strip()
        if not data or data == "[DONE]":
            return ""

        try:
            chunk = json.loads(data)
        except json.JSONDecodeError:
            return ""

        choices = chunk.get("choices")
        if isinstance(choices, list) and choices:
            delta = choices[0].get("delta") if isinstance(choices[0], dict) else None
            if isinstance(delta, dict) and isinstance(delta.get("content"), str):
                return delta["content"]

            message = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"]

        message = chunk.get("message")
        if isinstance(message, dict) and isinstance(message.get("content"), str):
            return message["content"]

        return ""


def get_chat_service() -> OllamaChatService:
    return OllamaChatService()


async def generate_ai_response(
    prompt: str,
    context: list[dict[str, str] | AIMessage] | None = None,
    *,
    system_prompt: str | None = None,
    temperature: float = 0.2,
    model: str | None = None,
    max_tokens: int | None = None,
) -> AIGeneration:
    return await get_chat_service().generate(
        prompt,
        context,
        system_prompt=system_prompt,
        temperature=temperature,
        model=model,
        max_tokens=max_tokens,
    )


async def stream_ai_response(
    prompt: str,
    context: list[dict[str, str] | AIMessage] | None = None,
    *,
    system_prompt: str | None = None,
    temperature: float = 0.2,
    model: str | None = None,
    max_tokens: int | None = None,
) -> AsyncGenerator[str, None]:
    async for token in get_chat_service().stream(
        prompt,
        context,
        system_prompt=system_prompt,
        temperature=temperature,
        model=model,
        max_tokens=max_tokens,
    ):
        yield token


async def call_llm(
    prompt: str,
    context: list[dict[str, str]] | None = None,
    temperature: float = 0.2,
    model: str | None = None,
    max_tokens: int | None = None,
) -> str:
    generation = await generate_ai_response(
        prompt,
        context=context,
        temperature=temperature,
        model=model,
        max_tokens=max_tokens,
    )
    return generation.content


async def call_llm_stream(
    prompt: str,
    context: list[dict[str, str]] | None = None,
    temperature: float = 0.2,
    model: str | None = None,
    max_tokens: int | None = None,
) -> AsyncGenerator[str, None]:
    async for token in stream_ai_response(
        prompt,
        context=context,
        temperature=temperature,
        model=model,
        max_tokens=max_tokens,
    ):
        yield token
