from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Literal

import httpx
from fastapi import status

from ..core.config import get_settings
from .prompt_trust import append_untrusted_content_policy
from ..observability.safe_logging import allow_sensitive_logging, safe_text_preview
from ..rag.token_utils import count_tokens, tail_tokens

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

    name = "ollama"

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
        self.max_context_tokens = max(128, min(int(self.settings.AI_MAX_CONTEXT_TOKENS), 16_000))
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
        remaining_tokens = self.max_context_tokens

        for item in reversed(context[-self.max_context_messages :]):
            role = item.role if isinstance(item, AIMessage) else item.get("role")
            content = item.content if isinstance(item, AIMessage) else item.get("content")

            if role not in ("system", "user", "assistant"):
                continue
            if not isinstance(content, str):
                continue

            clean_content = content.strip()
            if not clean_content:
                continue

            message_tokens = count_tokens(clean_content, model=self.default_model) + 4
            if message_tokens > remaining_tokens:
                if not normalized and remaining_tokens > 8:
                    trimmed_content = tail_tokens(clean_content, remaining_tokens - 4)
                    if trimmed_content:
                        normalized.append(AIMessage(role=role, content=trimmed_content))
                        remaining_tokens = 0
                        break
                continue

            normalized.append(AIMessage(role=role, content=clean_content))
            remaining_tokens -= message_tokens
            if remaining_tokens <= 8:
                break

        return list(reversed(normalized))

    def _build_messages(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None = None,
        system_prompt: str | None = None,
    ) -> list[dict[str, str]]:
        messages: list[AIMessage] = []
        effective_system_prompt = append_untrusted_content_policy(system_prompt or self.system_prompt)
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
        messages_summary = [
            {
                "index": index,
                "role": message.get("role"),
                "chars": len(message.get("content") or ""),
                "has_web_search_results": "WEB SEARCH RESULTS:" in (message.get("content") or ""),
                "has_document_context": "DOCUMENT CONTEXT:" in (message.get("content") or ""),
                "preview": safe_text_preview(message.get("content"), max_chars=360),
            }
            for index, message in enumerate(payload["messages"])
        ]
        logger.info(
            "Prepared Ollama request: url=%s model=%s stream=%s messages=%d num_predict=%d "
            "final_user_prompt_length=%d has_web_results=%s has_document_context=%s messages_summary=%s",
            self.model_url,
            payload["model"],
            stream,
            len(payload["messages"]),
            output_tokens,
            len(prompt or ""),
            "WEB SEARCH RESULTS:" in (prompt or ""),
            "DOCUMENT CONTEXT:" in (prompt or ""),
            messages_summary,
        )
        logger.debug("Ollama final user prompt preview: %r", safe_text_preview(prompt, max_chars=500))
        if allow_sensitive_logging():
            logger.debug("Ollama final payload debug: %s", json.dumps(payload, ensure_ascii=False))
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
                    provider=self.name,
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
                        safe_text_preview(exc.response.text, max_chars=500),
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


class OpenAIChatService(OllamaChatService):
    """OpenAI chat-completions provider used as a managed failover target."""

    name = "openai"

    def __init__(self, api_key: str | None = None) -> None:
        self.settings = get_settings()
        self.api_key = api_key or self.settings.OPENAI_API_KEY
        self.api_base = self.settings.OPENAI_API_BASE.rstrip("/")
        self.default_model = self.settings.OPENAI_CHAT_MODEL
        self.system_prompt = self.settings.AI_SYSTEM_PROMPT
        self.request_timeout = self.settings.AI_REQUEST_TIMEOUT_SECONDS
        self.stream_timeout = self.settings.AI_STREAM_TIMEOUT_SECONDS
        self.max_retries = max(0, self.settings.AI_MAX_RETRIES)
        self.max_output_tokens = max(1, min(int(self.settings.AI_MAX_OUTPUT_TOKENS), 4096))
        self.max_context_messages = max(1, min(int(self.settings.AI_MAX_CONTEXT_MESSAGES), 8))
        self.max_context_tokens = max(128, min(int(self.settings.AI_MAX_CONTEXT_TOKENS), 32_000))

    def _resolve_model(self, requested_model: str | None) -> str:
        if requested_model and ":" not in requested_model and not requested_model.lower().startswith("claude"):
            return requested_model
        return self.default_model

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
        if not self.api_key:
            raise ModelServiceError("OpenAI provider is not configured.", status.HTTP_503_SERVICE_UNAVAILABLE)

        output_tokens = max(1, min(int(max_tokens or self.max_output_tokens), 4096))
        payload = {
            "model": self._resolve_model(model),
            "messages": self._build_messages(prompt, context, system_prompt),
            "temperature": temperature,
            "max_tokens": output_tokens,
            "stream": False,
        }
        timeout = httpx.Timeout(self.request_timeout, connect=10.0)
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        logger.info(
            "Prepared OpenAI request: model=%s messages=%d max_tokens=%d final_user_prompt_length=%d",
            payload["model"],
            len(payload["messages"]),
            output_tokens,
            len(prompt or ""),
        )

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(f"{self.api_base}/chat/completions", headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            logger.warning("OpenAI request timed out.")
            raise ModelServiceError("OpenAI request timed out.", status.HTTP_504_GATEWAY_TIMEOUT) from exc
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "OpenAI HTTP %s: %s",
                exc.response.status_code,
                safe_text_preview(exc.response.text, max_chars=500),
            )
            raise ModelServiceError("OpenAI request failed.", status.HTTP_502_BAD_GATEWAY) from exc
        except (httpx.RequestError, json.JSONDecodeError) as exc:
            logger.warning("OpenAI generation failed: %s", exc)
            raise ModelServiceError("OpenAI provider unavailable.", status.HTTP_503_SERVICE_UNAVAILABLE) from exc

        return AIGeneration(
            content=self._extract_content(data),
            model=str(data.get("model") or payload["model"]),
            provider=self.name,
            usage=data.get("usage") if isinstance(data.get("usage"), dict) else {},
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
        generation = await self.generate(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=max_tokens,
        )
        if generation.content:
            yield generation.content


class AnthropicChatService(OllamaChatService):
    """Anthropic Messages API provider used as a managed failover target."""

    name = "anthropic"

    def __init__(self, api_key: str | None = None) -> None:
        self.settings = get_settings()
        self.api_key = api_key or self.settings.ANTHROPIC_API_KEY
        self.api_base = self.settings.ANTHROPIC_API_BASE.rstrip("/")
        self.api_version = self.settings.ANTHROPIC_API_VERSION
        self.default_model = self.settings.ANTHROPIC_CHAT_MODEL
        self.system_prompt = self.settings.AI_SYSTEM_PROMPT
        self.request_timeout = self.settings.AI_REQUEST_TIMEOUT_SECONDS
        self.stream_timeout = self.settings.AI_STREAM_TIMEOUT_SECONDS
        self.max_retries = max(0, self.settings.AI_MAX_RETRIES)
        self.max_output_tokens = max(1, min(int(self.settings.AI_MAX_OUTPUT_TOKENS), 4096))
        self.max_context_messages = max(1, min(int(self.settings.AI_MAX_CONTEXT_MESSAGES), 8))
        self.max_context_tokens = max(128, min(int(self.settings.AI_MAX_CONTEXT_TOKENS), 32_000))

    def _resolve_model(self, requested_model: str | None) -> str:
        if requested_model and requested_model.lower().startswith("claude"):
            return requested_model
        return self.default_model

    @staticmethod
    def _merge_adjacent_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
        merged: list[dict[str, str]] = []
        for message in messages:
            role = message["role"] if message["role"] in {"user", "assistant"} else "user"
            content = message["content"]
            if merged and merged[-1]["role"] == role:
                merged[-1]["content"] = f"{merged[-1]['content']}\n\n{content}"
                continue
            merged.append({"role": role, "content": content})
        return merged

    def _build_anthropic_payload(
        self,
        prompt: str,
        context: list[dict[str, str] | AIMessage] | None,
        *,
        system_prompt: str | None,
        temperature: float,
        model: str | None,
        max_tokens: int | None,
    ) -> dict[str, Any]:
        output_tokens = max(1, min(int(max_tokens or self.max_output_tokens), 4096))
        messages = self._build_messages(prompt, context, system_prompt)
        system_messages = [message["content"] for message in messages if message["role"] == "system"]
        conversation_messages = [message for message in messages if message["role"] != "system"]
        payload: dict[str, Any] = {
            "model": self._resolve_model(model),
            "messages": self._merge_adjacent_messages(conversation_messages),
            "temperature": temperature,
            "max_tokens": output_tokens,
        }
        if system_messages:
            payload["system"] = "\n\n".join(system_messages)
        return payload

    @staticmethod
    def _extract_anthropic_content(payload: dict[str, Any]) -> str:
        parts = payload.get("content")
        if not isinstance(parts, list):
            raise ModelServiceError("Anthropic returned an invalid response.", status.HTTP_502_BAD_GATEWAY)

        text = "".join(
            part.get("text", "")
            for part in parts
            if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str)
        ).strip()
        if not text:
            raise ModelServiceError("Anthropic returned an empty response.", status.HTTP_502_BAD_GATEWAY)
        return text

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
        if not self.api_key:
            raise ModelServiceError("Anthropic provider is not configured.", status.HTTP_503_SERVICE_UNAVAILABLE)

        payload = self._build_anthropic_payload(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=max_tokens,
        )
        timeout = httpx.Timeout(self.request_timeout, connect=10.0)
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": self.api_version,
            "Content-Type": "application/json",
        }

        logger.info(
            "Prepared Anthropic request: model=%s messages=%d max_tokens=%d final_user_prompt_length=%d",
            payload["model"],
            len(payload["messages"]),
            payload["max_tokens"],
            len(prompt or ""),
        )

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(f"{self.api_base}/v1/messages", headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            logger.warning("Anthropic request timed out.")
            raise ModelServiceError("Anthropic request timed out.", status.HTTP_504_GATEWAY_TIMEOUT) from exc
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Anthropic HTTP %s: %s",
                exc.response.status_code,
                safe_text_preview(exc.response.text, max_chars=500),
            )
            raise ModelServiceError("Anthropic request failed.", status.HTTP_502_BAD_GATEWAY) from exc
        except (httpx.RequestError, json.JSONDecodeError) as exc:
            logger.warning("Anthropic generation failed: %s", exc)
            raise ModelServiceError("Anthropic provider unavailable.", status.HTTP_503_SERVICE_UNAVAILABLE) from exc

        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        return AIGeneration(
            content=self._extract_anthropic_content(data),
            model=str(data.get("model") or payload["model"]),
            provider=self.name,
            usage={
                "prompt_tokens": usage.get("input_tokens"),
                "completion_tokens": usage.get("output_tokens"),
            },
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
        generation = await self.generate(
            prompt,
            context,
            system_prompt=system_prompt,
            temperature=temperature,
            model=model,
            max_tokens=max_tokens,
        )
        if generation.content:
            yield generation.content


class ProviderManager:
    """Route chat requests through configured providers with timeout-based failover."""

    def __init__(
        self,
        *,
        providers: dict[str, OllamaChatService] | None = None,
        provider_order: list[str] | None = None,
        failover_latency_threshold: float | None = None,
        request_timeout: float | None = None,
    ) -> None:
        self.settings = get_settings()
        self.providers = providers if providers is not None else self._build_providers()
        self.provider_order = self._normalize_provider_order(provider_order or self.settings.AI_PROVIDER_ORDER)
        self.request_timeout = max(0.001, float(request_timeout or self.settings.AI_REQUEST_TIMEOUT_SECONDS))
        threshold = (
            failover_latency_threshold
            if failover_latency_threshold is not None
            else self.settings.AI_FAILOVER_LATENCY_THRESHOLD_SECONDS
        )
        self.failover_latency_threshold = max(0.001, float(threshold))

    def _build_providers(self) -> dict[str, OllamaChatService]:
        providers: dict[str, OllamaChatService] = {"ollama": OllamaChatService()}
        if self.settings.OPENAI_API_KEY:
            providers["openai"] = OpenAIChatService(self.settings.OPENAI_API_KEY)
        if self.settings.ANTHROPIC_API_KEY:
            providers["anthropic"] = AnthropicChatService(self.settings.ANTHROPIC_API_KEY)
        logger.info("Initialized AI chat providers: %s", sorted(providers))
        return providers

    @staticmethod
    def _normalize_provider_order(provider_order: list[str] | str) -> list[str]:
        if isinstance(provider_order, str):
            raw_names = provider_order.split(",")
        else:
            raw_names = provider_order
        normalized: list[str] = []
        for raw_name in raw_names:
            name = raw_name.strip().lower()
            if name and name not in normalized:
                normalized.append(name)
        return normalized

    def _candidate_providers(self) -> list[tuple[str, OllamaChatService]]:
        ordered_names = [name for name in self.provider_order if name in self.providers]
        ordered_names.extend(name for name in self.providers if name not in ordered_names)
        return [(name, self.providers[name]) for name in ordered_names]

    def _timeout_for_attempt(self, provider_name: str, attempt_index: int, total_attempts: int) -> float:
        if provider_name == "ollama" and attempt_index == 0 and total_attempts > 1:
            return min(self.failover_latency_threshold, self.request_timeout)
        return self.request_timeout

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
        candidates = self._candidate_providers()
        if not candidates:
            raise ModelServiceError("No AI providers are configured.", status.HTTP_503_SERVICE_UNAVAILABLE)

        last_error: BaseException | None = None
        for attempt_index, (provider_name, provider) in enumerate(candidates):
            timeout_seconds = self._timeout_for_attempt(provider_name, attempt_index, len(candidates))
            try:
                generation = await asyncio.wait_for(
                    provider.generate(
                        prompt,
                        context,
                        system_prompt=system_prompt,
                        temperature=temperature,
                        model=model,
                        max_tokens=max_tokens,
                    ),
                    timeout=timeout_seconds,
                )
                if attempt_index > 0:
                    logger.warning(
                        "AI generation succeeded after failover: provider=%s attempts=%d",
                        generation.provider,
                        attempt_index + 1,
                    )
                return generation
            except asyncio.TimeoutError as exc:
                last_error = exc
                logger.warning(
                    "AI provider %s exceeded timeout %.2fs; trying next provider if available.",
                    provider_name,
                    timeout_seconds,
                )
            except ModelServiceError as exc:
                last_error = exc
                logger.warning(
                    "AI provider %s failed with status %s; trying next provider if available.",
                    provider_name,
                    exc.status_code,
                )

        raise ModelServiceError("All configured AI providers are unavailable.", status.HTTP_503_SERVICE_UNAVAILABLE) from last_error

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
        candidates = self._candidate_providers()
        if not candidates:
            raise ModelServiceError("No AI providers are configured.", status.HTTP_503_SERVICE_UNAVAILABLE)

        last_error: BaseException | None = None
        for attempt_index, (provider_name, provider) in enumerate(candidates):
            timeout_seconds = self._timeout_for_attempt(provider_name, attempt_index, len(candidates))
            emitted_token = False
            try:
                stream = provider.stream(
                    prompt,
                    context,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    model=model,
                    max_tokens=max_tokens,
                )
                stream_iterator = stream.__aiter__()
                first_token = await asyncio.wait_for(anext(stream_iterator), timeout=timeout_seconds)
                emitted_token = True
                yield first_token
                async for token in stream_iterator:
                    yield token
                return
            except StopAsyncIteration:
                return
            except asyncio.TimeoutError as exc:
                last_error = exc
                if emitted_token:
                    raise ModelServiceError("Model stream timed out.", status.HTTP_504_GATEWAY_TIMEOUT) from exc
                logger.warning(
                    "AI stream provider %s exceeded timeout %.2fs before first token; trying next provider if available.",
                    provider_name,
                    timeout_seconds,
                )
            except ModelServiceError as exc:
                last_error = exc
                if emitted_token:
                    raise
                logger.warning(
                    "AI stream provider %s failed with status %s before first token; trying next provider if available.",
                    provider_name,
                    exc.status_code,
                )

        raise ModelServiceError("All configured AI stream providers are unavailable.", status.HTTP_503_SERVICE_UNAVAILABLE) from last_error


def get_chat_service() -> ProviderManager:
    return ProviderManager()


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
    system_prompt: str | None = None,
    temperature: float = 0.2,
    model: str | None = None,
    max_tokens: int | None = None,
) -> str:
    generation = await generate_ai_response(
        prompt,
        context=context,
        system_prompt=system_prompt,
        temperature=temperature,
        model=model,
        max_tokens=max_tokens,
    )
    return generation.content


async def call_llm_stream(
    prompt: str,
    context: list[dict[str, str]] | None = None,
    system_prompt: str | None = None,
    temperature: float = 0.2,
    model: str | None = None,
    max_tokens: int | None = None,
) -> AsyncGenerator[str, None]:
    async for token in stream_ai_response(
        prompt,
        context=context,
        system_prompt=system_prompt,
        temperature=temperature,
        model=model,
        max_tokens=max_tokens,
    ):
        yield token
