import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
from typing import Any, AsyncGenerator

import requests
from fastapi import status

from ..core.config import get_settings

logger = logging.getLogger(__name__)

_LLM_EXECUTOR = ThreadPoolExecutor(max_workers=5, thread_name_prefix="llm_worker")
_LLM_SEMAPHORE: asyncio.Semaphore | None = None

def _get_llm_semaphore() -> asyncio.Semaphore:
    global _LLM_SEMAPHORE
    if _LLM_SEMAPHORE is None:
        _LLM_SEMAPHORE = asyncio.Semaphore(10)
    return _LLM_SEMAPHORE

class ModelServiceError(Exception):
    def __init__(self, message: str, status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR):
        super().__init__(message)
        self.status_code = status_code

async def call_llm(prompt: str, context: list[dict[str, str]] | None = None, temperature: float = 0.7) -> str:
    messages = context or []
    messages.append({"role": "user", "content": prompt})

    settings = get_settings()
    payload = {
        "model": "llama3.2",
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }

    loop = asyncio.get_running_loop()
    semaphore = _get_llm_semaphore()

    async with semaphore:
        try:
            response = await loop.run_in_executor(
                _LLM_EXECUTOR,
                lambda: requests.post(settings.MODEL_URL, json=payload, timeout=30.0),
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except requests.exceptions.RequestException as exc:
            logger.exception("LLM generation failed")
            raise ModelServiceError("Model service unavailable.", status.HTTP_503_SERVICE_UNAVAILABLE) from exc

async def call_llm_stream(prompt: str, context: list[dict[str, str]] | None = None, temperature: float = 0.7) -> AsyncGenerator[str, None]:
    messages = context or []
    messages.append({"role": "user", "content": prompt})

    settings = get_settings()
    payload = {
        "model": "llama3.2",
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }

    loop = asyncio.get_running_loop()
    semaphore = _get_llm_semaphore()

    async with semaphore:
        try:
            response = await loop.run_in_executor(
                _LLM_EXECUTOR,
                lambda: requests.post(settings.MODEL_URL, json=payload, stream=True, timeout=30.0),
            )
            response.raise_for_status()
        except requests.exceptions.RequestException as exc:
            logger.exception("LLM stream generation failed")
            raise ModelServiceError("Model service unavailable.", status.HTTP_503_SERVICE_UNAVAILABLE) from exc

        def read_chunks():
            for line in response.iter_lines():
                if line:
                    decoded = line.decode("utf-8")
                    if decoded.startswith("data: "):
                        import json
                        data_str = decoded[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            yield delta.get("content", "")
                        except json.JSONDecodeError:
                            continue

        for token in read_chunks():
            if token:
                yield token
                await asyncio.sleep(0)
