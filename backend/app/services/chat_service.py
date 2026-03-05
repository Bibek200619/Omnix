from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import requests
from fastapi import status

from ..core.config import get_settings

_LLM_EXECUTOR = ThreadPoolExecutor(max_workers=5, thread_name_prefix="llm_worker")
_LLM_SEMAPHORE: asyncio.Semaphore | None = None

def _get_llm_semaphore() -> asyncio.Semaphore:
    global _LLM_SEMAPHORE
    if _LLM_SEMAPHORE is None:
        _LLM_SEMAPHORE = asyncio.Semaphore(5)
    return _LLM_SEMAPHORE


class ModelServiceError(RuntimeError):
    def __init__(
        self,
        detail: str,
        status_code: int = status.HTTP_502_BAD_GATEWAY,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code


def _normalize_context(context: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    if not context:
        return []

    messages: list[dict[str, str]] = []
    for item in context:
        role = str(item.get("role", "")).strip()
        content = item.get("content")
        if role and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content.strip()})
    return messages


def _extract_assistant_content(content: Any) -> str:
    if isinstance(content, str) and content.strip():
        return content.strip()

    if isinstance(content, list):
        text_parts = [
            part.get("text", "").strip()
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        merged = "\n".join(part for part in text_parts if part)
        if merged:
            return merged

    raise ModelServiceError("Model response did not include assistant content.")


def _call_llm_sync(
    message: str,
    context: list[dict[str, str]] | None,
    temperature: float,
) -> str:
    try:
        model_url = get_settings().validated_model_url
    except ValueError as exc:
        raise ModelServiceError(
            "Model endpoint configuration is invalid.",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        ) from exc

    payload = {
        "model": "default",
        "messages": [*_normalize_context(context), {"role": "user", "content": message}],
        "temperature": temperature,
    }

    try:
        response = requests.post(
            model_url,
            json=payload,
            timeout=(3.0, 30.0),
        )
    except requests.exceptions.Timeout as exc:
        raise ModelServiceError(
            "Model response timed out.",
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
        ) from exc
    except requests.RequestException as exc:
        raise ModelServiceError(f"Model request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text.strip() or "No error details returned."
        raise ModelServiceError(
            f"Model server returned {response.status_code}: {detail[:500]}",
        )

    try:
        body = response.json()
    except ValueError as exc:
        raise ModelServiceError("Model server returned invalid JSON.") from exc

    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelServiceError("Model response format was invalid.") from exc

    return _extract_assistant_content(content)


async def call_llm(
    message: str,
    context: list[dict[str, Any]] | None = None,
    temperature: float = 0.2,
) -> str:
    sem = _get_llm_semaphore()
    if sem.locked():
        raise ModelServiceError(
            "System is currently at capacity. Please try again later.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    async with sem:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_LLM_EXECUTOR, _call_llm_sync, message, context, temperature)
