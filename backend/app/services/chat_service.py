from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
from typing import Any

import requests
from fastapi import status

from ..core.config import get_settings
from ..rag.context_builder import ContextBuilder
from ..rag.retrieval import RAGRetriever

logger = logging.getLogger(__name__)

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


def _build_dev_mode_response(
    message: str,
    context: list[dict[str, str]] | None,
) -> str:
    normalized_message = " ".join(message.strip().split())
    if len(normalized_message) > 240:
        normalized_message = f"{normalized_message[:237]}..."

    context_count = len(context or [])
    context_note = (
        f"\n\nI also received {context_count} prior context message"
        f"{'' if context_count == 1 else 's'} for this conversation."
        if context_count
        else ""
    )

    return (
        "Omnix backend is connected successfully.\n\n"
        f"I received your message: \"{normalized_message}\"\n\n"
        "Development mode is enabled, so no external AI provider was called. "
        "Authentication, conversation persistence, message storage, and response "
        "delivery are ready for frontend testing."
        f"{context_note}"
    )


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
        logger.info("Raw LLM response: %s", body)
    except ValueError as exc:
        raise ModelServiceError("Model server returned invalid JSON.") from exc

    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelServiceError("Model response format was invalid.") from exc

    final_content = _extract_assistant_content(content)
    
    if len(final_content) < 10:
        logger.warning("LLM response too short (%d chars). Falling back to context.", len(final_content))
        return message

    return final_content


async def call_llm(
    message: str,
    context: list[dict[str, Any]] | None = None,
    temperature: float = 0.2,
) -> str:
    normalized_context = _normalize_context(context)
    settings = get_settings()
    if settings.DEV_MODE:
        logger.info("DEV_MODE enabled; returning mock assistant response.")
        return _build_dev_mode_response(message, normalized_context)

    sem = _get_llm_semaphore()
    if sem.locked():
        raise ModelServiceError(
            "System is currently at capacity. Please try again later.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    async with sem:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _LLM_EXECUTOR,
            _call_llm_sync,
            message,
            normalized_context,
            temperature,
        )


async def call_llm_stream(
    message: str,
    context: list[dict[str, Any]] | None = None,
    temperature: float = 0.2,
) -> "async_generator[str, None]":
    """
    Async generator that yields incremental text chunks from the LLM.

    In DEV_MODE this simulates realistic streaming by yielding small token chunks
    with short delays. In production mode (when DEV_MODE is False) this will
    fall back to calling the synchronous LLM and yielding the full response in
    small slices to preserve streaming-compatible behavior.
    """
    normalized_context = _normalize_context(context)
    settings = get_settings()

    # DEV mode: simulate streaming
    if settings.DEV_MODE:
        logger.info("Streaming mock response in DEV_MODE.")
        full = _build_dev_mode_response(message, normalized_context)
        # Tokenize simply on words/punctuation for streaming effect
        import re

        tokens = re.split(r"(\s+|[^\s\w]+|\w+)", full)
        tokens = [t for t in tokens if t]
        for token in tokens:
            yield token
            # realistic variable delay
            await asyncio.sleep(0.02 + (len(token) / 80))
        return

    # Production: call model sync in executor then stream slices
    sem = _get_llm_semaphore()
    if sem.locked():
        raise ModelServiceError(
            "System is currently at capacity. Please try again later.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    async with sem:
        loop = asyncio.get_running_loop()
        try:
            full = await loop.run_in_executor(
                _LLM_EXECUTOR,
                _call_llm_sync,
                message,
                normalized_context,
                temperature,
            )
        except Exception:
            # bubble up as ModelServiceError
            raise

        # yield in small chunks to avoid blocking frontends
        import re

        tokens = re.split(r"(\s+|[^\s\w]+|\w+)", full)
        tokens = [t for t in tokens if t]
        for token in tokens:
            yield token
            await asyncio.sleep(0.01)


class ChatService:
    """
    Connects the RAG retrieval pipeline with the LLM API.
    Coordinates retrieving context, building the prompt, and requesting a response
    by reusing the existing async call_llm functionality.
    """

    def __init__(self, retriever: RAGRetriever, context_builder: ContextBuilder) -> None:
        """
        Initializes the ChatService.

        Args:
            retriever (RAGRetriever): The initialized retrieval engine.
            context_builder (ContextBuilder): The initialized context formatter.
        """
        if not isinstance(retriever, RAGRetriever):
            raise TypeError("retriever must be an instance of RAGRetriever.")
        if not isinstance(context_builder, ContextBuilder):
            raise TypeError("context_builder must be an instance of ContextBuilder.")

        self.retriever = retriever
        self.context_builder = context_builder

    async def generate_response(self, query: str, user_id: str) -> str:
        """
        Processes a user query through the RAG pipeline.
        DEV MODE: Bypasses the LLM call entirely and returns the best chunks directly.

        Args:
            query (str): The user's question or input.
            user_id (str): The ID of the requesting user.

        Returns:
            str: The raw text from the best chunks, or a fallback message if none found.
        """
        if not query or not query.strip():
            logger.warning("Empty query provided to ChatService.")
            return "Please provide a valid query."

        # Step 1: Retrieve relevant chunks
        try:
            logger.info("Retrieving context for query.")
            chunks = await self.retriever.retrieve(query, user_id)
        except Exception as exc:
            logger.exception("Context retrieval failed.")
            chunks = []

        # Step 2: Build the context prompt (kept for debugging)
        try:
            logger.info("Building LLM prompt with %d chunks.", len(chunks))
            context_prompt = self.context_builder.build_context(query, chunks)
        except Exception as exc:
            logger.exception("Context building failed.")
            return f"Error building context: {exc}"

        # Step 3: Debug (important)
        print("\n=== DEBUG CONTEXT ===\n")
        print(context_prompt)
        print("\n=====================\n")

        # Step 4: DEV MODE LOGIC (Bypass LLM)
        if not chunks:
            return "No relevant information found."
            
        import re
        seen_sentences = set()
        unique_sentences = []
        
        # Process chunks until we have 1-3 meaningful sentences
        for chunk in chunks:
            if len(unique_sentences) >= 3:
                break
                
            chunk = chunk.strip()
            if not chunk:
                continue
                
            # Basic sentence deduplication for cleaner output
            sentences = [s.strip() for s in re.split(r"(?<=[.?!])\s+", chunk) if len(s.strip()) > 10]
            
            for s in sentences:
                # Normalize for comparison to catch near-duplicates
                s_lower = re.sub(r'[^a-z0-9]', '', s.lower())
                if not s_lower:
                    continue
                    
                if s_lower not in seen_sentences:
                    seen_sentences.add(s_lower)
                    # Ensure it ends with punctuation
                    if not re.search(r'[.?!]$', s):
                        s += "."
                    unique_sentences.append(s)
                
                if len(unique_sentences) >= 3:
                    break

        if not unique_sentences:
            return "No relevant information found."

        answer = " ".join(unique_sentences)
        return f"Based on available data:\n\n{answer}"
