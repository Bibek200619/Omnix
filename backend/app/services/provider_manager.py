from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Callable

import httpx
from fastapi import status

from .chat_service import AIGeneration, AIMessage, ModelServiceError, OllamaChatService
from ..core.config import get_settings

logger = logging.getLogger(__name__)


HttpClientFactory = Callable[..., Any]


class ProviderManager:
    """Route active chat requests across cloud providers with Ollama fallback."""

    def __init__(
        self,
        *,
        settings: Any | None = None,
        ollama_service: OllamaChatService | None = None,
        http_client_factory: HttpClientFactory | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.ollama_service = ollama_service
        self.http_client_factory = http_client_factory or httpx.AsyncClient
        self.provider_name = self._select_provider()
        self.system_prompt = self.settings.AI_SYSTEM_PROMPT
        self.max_context_messages = max(1, int(self.settings.AI_MAX_CONTEXT_MESSAGES))
        self.max_context_chars = max(1000, int(self.settings.AI_MAX_CONTEXT_CHARS))

    def _select_provider(self) -> str:
        configured = (self.settings.AI_PROVIDER or "auto").strip().lower()

        if configured == "openai":
            if self.settings.OPENAI_API_KEY:
                return "openai"
            logger.warning("AI_PROVIDER=openai is configured without OPENAI_API_KEY; falling back.")
        elif configured == "anthropic":
            if self.settings.ANTHROPIC_API_KEY:
                return "anthropic"
            logger.warning("AI_PROVIDER=anthropic is configured without ANTHROPIC_API_KEY; falling back.")
        elif configured == "ollama":
            return "ollama"
        elif configured != "auto":
            logger.warning("Unknown AI_PROVIDER=%s; using auto routing.", configured)

        if self.settings.OPENAI_API_KEY:
            return "openai"
        if self.settings.ANTHROPIC_API_KEY:
            return "anthropic"
        return "ollama"

    def _ollama(self) -> OllamaChatService:
        if self.ollama_service is None:
            self.ollama_service = OllamaChatService()
        return self.ollama_service

    def _provider_token_cap(self, provider: str) -> int:
        if provider == "openai":
            return max(1, int(self.settings.OPENAI_MAX_OUTPUT_TOKENS))
        if provider == "anthropic":
            return max(1, int(self.settings.ANTHROPIC_MAX_OUTPUT_TOKENS))
        return max(1, int(self.settings.OLLAMA_MAX_OUTPUT_TOKENS))

    def _max_tokens(self, provider: str, requested: int | None) -> int:
        cap = self._provider_token_cap(provider)
        return max(1, min(int(requested or cap), cap))

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

    async def generate(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None = None,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        model: str | None = None,
        max_tokens: int | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> AIGeneration:
        provider = self.provider_name
        capped_tokens = self._max_tokens(provider, max_tokens)

        if provider == "openai":
            return await self._generate_openai(
                prompt,
                context,
                system_prompt=system_prompt,
                temperature=temperature,
                model=model,
                max_tokens=capped_tokens,
                response_format=response_format,
            )
        if provider == "anthropic":
            return await self._generate_anthropic(
                prompt,
                context,
                system_prompt=system_prompt,
                temperature=temperature,
                model=model,
                max_tokens=capped_tokens,
            )

        return await self._ollama().generate(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=capped_tokens,
        )

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
        provider = self.provider_name
        capped_tokens = self._max_tokens(provider, max_tokens)

        if provider == "openai":
            async for token in self._stream_openai(
                prompt,
                context,
                system_prompt=system_prompt,
                temperature=temperature,
                model=model,
                max_tokens=capped_tokens,
            ):
                yield token
            return

        if provider == "anthropic":
            async for token in self._stream_anthropic(
                prompt,
                context,
                system_prompt=system_prompt,
                temperature=temperature,
                model=model,
                max_tokens=capped_tokens,
            ):
                yield token
            return

        async for token in self._ollama().stream(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=capped_tokens,
        ):
            yield token

    async def _generate_openai(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None,
        *,
        system_prompt: str | None,
        temperature: float,
        model: str | None,
        max_tokens: int,
        response_format: dict[str, Any] | None,
    ) -> AIGeneration:
        payload: dict[str, Any] = {
            "model": model or self.settings.OPENAI_MODEL,
            "messages": self._build_messages(prompt, context, system_prompt),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format:
            payload["response_format"] = response_format

        data = await self._post_json(
            f"{self.settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            payload=payload,
            provider="openai",
        )

        return AIGeneration(
            content=OllamaChatService._extract_content(data),
            model=str(data.get("model") or payload["model"]),
            provider="openai",
            usage=data.get("usage") if isinstance(data.get("usage"), dict) else {},
        )

    async def _generate_anthropic(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None,
        *,
        system_prompt: str | None,
        temperature: float,
        model: str | None,
        max_tokens: int,
    ) -> AIGeneration:
        payload = self._anthropic_payload(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=max_tokens,
            stream=False,
        )

        data = await self._post_json(
            f"{self.settings.ANTHROPIC_BASE_URL.rstrip('/')}/messages",
            headers={
                "x-api-key": str(self.settings.ANTHROPIC_API_KEY),
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            payload=payload,
            provider="anthropic",
        )

        return AIGeneration(
            content=self._extract_anthropic_content(data),
            model=str(data.get("model") or payload["model"]),
            provider="anthropic",
            usage=data.get("usage") if isinstance(data.get("usage"), dict) else {},
        )

    async def _post_json(
        self,
        url: str,
        *,
        headers: dict[str, str],
        payload: dict[str, Any],
        provider: str,
    ) -> dict[str, Any]:
        timeout = httpx.Timeout(float(self.settings.AI_REQUEST_TIMEOUT_SECONDS), connect=10.0)
        try:
            async with self.http_client_factory(timeout=timeout) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            raise ModelServiceError(
                f"{provider} request timed out.",
                status.HTTP_504_GATEWAY_TIMEOUT,
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.warning("%s rejected request with HTTP %s.", provider, exc.response.status_code)
            raise ModelServiceError(
                f"{provider} rejected the request.",
                status.HTTP_502_BAD_GATEWAY,
            ) from exc
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            logger.warning("%s generation failed: %s", provider, exc)
            raise ModelServiceError(
                f"{provider} service unavailable.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            ) from exc

        if not isinstance(data, dict):
            raise ModelServiceError(
                f"{provider} returned an invalid response.",
                status.HTTP_502_BAD_GATEWAY,
            )
        return data

    async def _stream_openai(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None,
        *,
        system_prompt: str | None,
        temperature: float,
        model: str | None,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        payload = {
            "model": model or self.settings.OPENAI_MODEL,
            "messages": self._build_messages(prompt, context, system_prompt),
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {self.settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }
        async for line in self._stream_lines(
            f"{self.settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
            headers=headers,
            payload=payload,
            provider="openai",
        ):
            token = OllamaChatService._parse_stream_line(line)
            if token:
                yield token

    async def _stream_anthropic(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None,
        *,
        system_prompt: str | None,
        temperature: float,
        model: str | None,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        payload = self._anthropic_payload(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=max_tokens,
            stream=True,
        )
        headers = {
            "x-api-key": str(self.settings.ANTHROPIC_API_KEY),
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        async for line in self._stream_lines(
            f"{self.settings.ANTHROPIC_BASE_URL.rstrip('/')}/messages",
            headers=headers,
            payload=payload,
            provider="anthropic",
        ):
            token = self._parse_anthropic_stream_line(line)
            if token:
                yield token

    async def _stream_lines(
        self,
        url: str,
        *,
        headers: dict[str, str],
        payload: dict[str, Any],
        provider: str,
    ) -> AsyncGenerator[str, None]:
        timeout = httpx.Timeout(float(self.settings.AI_STREAM_TIMEOUT_SECONDS), connect=10.0)
        try:
            async with self.http_client_factory(timeout=timeout) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        yield line
        except httpx.TimeoutException as exc:
            raise ModelServiceError(
                f"{provider} stream timed out.",
                status.HTTP_504_GATEWAY_TIMEOUT,
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.warning("%s stream rejected with HTTP %s.", provider, exc.response.status_code)
            raise ModelServiceError(
                f"{provider} rejected the streaming request.",
                status.HTTP_502_BAD_GATEWAY,
            ) from exc
        except httpx.HTTPError as exc:
            logger.warning("%s stream failed: %s", provider, exc)
            raise ModelServiceError(
                f"{provider} stream unavailable.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            ) from exc

    def _anthropic_payload(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None,
        *,
        system_prompt: str | None,
        temperature: float,
        model: str | None,
        max_tokens: int,
        stream: bool,
    ) -> dict[str, Any]:
        messages = self._build_messages(prompt, context, system_prompt)
        system_messages = [message["content"] for message in messages if message["role"] == "system"]
        chat_messages = [
            {"role": message["role"], "content": message["content"]}
            for message in messages
            if message["role"] in {"user", "assistant"}
        ]

        payload: dict[str, Any] = {
            "model": model or self.settings.ANTHROPIC_MODEL,
            "messages": chat_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if system_messages:
            payload["system"] = "\n\n".join(system_messages)
        if stream:
            payload["stream"] = True
        return payload

    @staticmethod
    def _extract_anthropic_content(payload: dict[str, Any]) -> str:
        content = payload.get("content")
        if isinstance(content, list):
            parts = [
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and isinstance(block.get("text"), str)
            ]
            return "".join(parts)
        raise ModelServiceError(
            "anthropic returned an invalid response.",
            status.HTTP_502_BAD_GATEWAY,
        )

    @staticmethod
    def _parse_anthropic_stream_line(line: str) -> str:
        data = line.removeprefix("data:").strip()
        if not data or data == "[DONE]" or data.startswith("event:"):
            return ""

        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            return ""

        if payload.get("type") == "error":
            error = payload.get("error")
            message = error.get("message") if isinstance(error, dict) else "stream error"
            raise ModelServiceError(str(message), status.HTTP_502_BAD_GATEWAY)

        if payload.get("type") == "content_block_delta":
            delta = payload.get("delta")
            if isinstance(delta, dict) and isinstance(delta.get("text"), str):
                return delta["text"]
        return ""
