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
    """Async Ollama chat client using the native /api/chat API."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.model_url = self.settings.ollama_chat_url
        self.default_model = self.settings.ollama_model
        self.system_prompt = self.settings.AI_SYSTEM_PROMPT
        self.request_timeout = self.settings.AI_REQUEST_TIMEOUT_SECONDS
        self.stream_timeout = self.settings.AI_STREAM_TIMEOUT_SECONDS
        self.max_retries = max(0, self.settings.AI_MAX_RETRIES)
        self.max_output_tokens = max(1, min(int(self.settings.AI_MAX_OUTPUT_TOKENS), 512))
        self.max_context_messages = max(1, min(int(self.settings.AI_MAX_CONTEXT_MESSAGES), 4))
        self.max_context_chars = max(1000, min(int(self.settings.AI_MAX_CONTEXT_CHARS), 8000))
        if self.settings.MODEL_URL.rstrip("/") != self.model_url.rstrip("/"):
            logger.warning(
                "MODEL_URL points at %s; using native Ollama chat endpoint %s.",
                self.settings.MODEL_URL,
                self.model_url,
            )

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
        output_tokens = max(1, min(int(max_tokens or self.max_output_tokens), 512))
        payload = {
            "model": model or self.default_model,
            "messages": self._build_messages(prompt, context, system_prompt),
            "stream": stream,
            "options": {
                "temperature": temperature,
                "num_predict": output_tokens,
            },
        }
        logger.info(
            "Prepared Ollama request: url=%s model=%s stream=%s messages=%d num_predict=%d final_user_prompt_length=%d",
            self.model_url,
            payload["model"],
            stream,
            len(payload["messages"]),
            output_tokens,
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
                    logger.warning(
                        "Ollama rejected request with HTTP %s at %s: %s",
                        status_code,
                        self.model_url,
                        exc.response.text[:500],
                    )
                    raise ModelServiceError(
                        "Ollama rejected the request. Check that phi3:mini is installed and MODEL_URL uses /api/chat.",
                        status.HTTP_502_BAD_GATEWAY,
                    ) from exc
                logger.warning("Ollama HTTP %s on attempt %s.", status_code, attempt + 1)
            except (httpx.RequestError, json.JSONDecodeError, ModelServiceError) as exc:
                last_error = exc
                logger.warning("Ollama generation failed on attempt %s: %s", attempt + 1, exc)

            if attempt < self.max_retries:
                await asyncio.sleep(0.25 * (2**attempt))

        raise ModelServiceError(
            "Model service unavailable. Ensure Ollama is running and phi3:mini is installed.",
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
            emitted_token = False
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", self.model_url, json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        token = self._parse_stream_line(line)
                        if token:
                            emitted_token = True
                            yield token
        except httpx.TimeoutException as exc:
            logger.warning("Ollama stream timed out.")
            raise ModelServiceError(
                "Model stream timed out.",
                status.HTTP_504_GATEWAY_TIMEOUT,
            ) from exc
        except ModelServiceError:
            raise
        except httpx.HTTPError as exc:
            logger.warning("Ollama stream failed at %s: %s", self.model_url, exc)
            if not emitted_token:
                try:
                    logger.info("Retrying Ollama request once without streaming after pre-token stream failure.")
                    fallback = await self.generate(
                        prompt,
                        context,
                        system_prompt=system_prompt,
                        temperature=temperature,
                        model=model,
                        max_tokens=max_tokens,
                    )
                    if fallback.content:
                        yield fallback.content
                        return
                except Exception:
                    logger.exception("Non-streaming Ollama fallback failed.")
            raise ModelServiceError(
                "Model service unavailable. Ensure Ollama is running and phi3:mini is installed.",
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

        if isinstance(chunk.get("error"), str) and chunk["error"].strip():
            raise ModelServiceError(
                f"Ollama returned an error: {chunk['error'].strip()}",
                status.HTTP_502_BAD_GATEWAY,
            )

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
