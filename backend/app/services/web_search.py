from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
import re
import time
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from ..core.config import get_settings
from ..retrieval.context_builder import ContextSupplement

logger = logging.getLogger(__name__)

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class WebSearchResult:
    title: str
    url: str
    snippet: str
    score: float = 0.0
    domain: str = ""
    favicon_url: str | None = None
    published_date: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_source(self, label: str | None = None) -> dict[str, Any]:
        payload = {
            "id": self.url,
            "label": label,
            "type": "web",
            "title": self.title,
            "url": self.url,
            "domain": self.domain,
            "favicon_url": self.favicon_url,
            "published_date": self.published_date,
            "excerpt": self.snippet,
            "chunk_preview": self.snippet,
            "score": self.score,
            "metadata": self.metadata,
        }
        return {key: value for key, value in payload.items() if value not in (None, "")}

    def to_supplement(self, *, workspace_id: str | None = None) -> ContextSupplement:
        return ContextSupplement(
            content=self._context_content(),
            title=self.title or self.domain or "Web result",
            source_type="web",
            source_id=self.url,
            workspace_id=workspace_id,
            score=self.score,
            metadata={
                "url": self.url,
                "domain": self.domain,
                "favicon_url": self.favicon_url,
                "published_date": self.published_date,
                "snippet": self.snippet,
                **self.metadata,
            },
        )

    def _context_content(self) -> str:
        parts = [
            f"Title: {self.title}",
            f"URL: {self.url}",
        ]
        if self.published_date:
            parts.append(f"Published: {self.published_date}")
        if self.snippet:
            parts.append(f"Snippet: {self.snippet}")
        return "\n".join(parts)


@dataclass(frozen=True, slots=True)
class WebSearchResponse:
    query: str
    results: list[WebSearchResult]
    provider: str = "tavily"
    answer: str | None = None
    error: str | None = None
    latency_ms: float = 0.0

    @property
    def ok(self) -> bool:
        return self.error is None

    def to_diagnostics(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "ok": self.ok,
            "result_count": len(self.results),
            "latency_ms": round(self.latency_ms, 2),
            "error": self.error,
        }


class WebSearchProvider(Protocol):
    async def search(self, query: str, *, max_results: int | None = None) -> WebSearchResponse:
        ...


class TavilySearchService:
    """Small Tavily provider adapter.

    Keeps API keys server-side, constrains query/result size, and returns a
    provider-neutral response that the context pipeline can consume.
    """

    def __init__(self) -> None:
        self.settings = get_settings()
        self.api_key = (self.settings.TAVILY_API_KEY or "").strip()
        self.enabled = bool(self.settings.WEB_SEARCH_ENABLED and self.api_key)
        self.max_results = max(1, min(int(self.settings.WEB_SEARCH_MAX_RESULTS), 10))
        self.timeout_seconds = max(1.0, min(float(self.settings.WEB_SEARCH_TIMEOUT_SECONDS), 20.0))
        self.snippet_max_chars = max(120, min(int(self.settings.WEB_SEARCH_SNIPPET_MAX_CHARS), 1200))
        self.search_depth = self.settings.WEB_SEARCH_DEPTH

    async def search(self, query: str, *, max_results: int | None = None) -> WebSearchResponse:
        started_at = time.perf_counter()
        clean_query = sanitize_query(query)
        if not self.enabled:
            return WebSearchResponse(
                query=clean_query,
                results=[],
                error="web_search_disabled_or_unconfigured",
            )
        if not clean_query:
            return WebSearchResponse(query=clean_query, results=[], error="empty_query")

        result_limit = max(1, min(int(max_results or self.max_results), self.max_results, 10))
        payload = {
            "query": clean_query,
            "search_depth": self.search_depth if self.search_depth in {"basic", "advanced"} else "basic",
            "max_results": result_limit,
            "include_answer": bool(self.settings.WEB_SEARCH_INCLUDE_ANSWER),
            "include_raw_content": False,
            "include_images": False,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        timeout = httpx.Timeout(self.timeout_seconds, connect=min(5.0, self.timeout_seconds))
        last_error: str | None = None

        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(TAVILY_SEARCH_URL, json=payload, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                latency_ms = (time.perf_counter() - started_at) * 1000
                return WebSearchResponse(
                    query=clean_query,
                    results=self._parse_results(data.get("results"), limit=result_limit),
                    answer=sanitize_text(data.get("answer"), max_chars=900) if data.get("answer") else None,
                    latency_ms=latency_ms,
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = type(exc).__name__
                logger.warning("Tavily search transport failure on attempt %d: %s", attempt + 1, exc)
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                last_error = f"http_{status_code}"
                if 400 <= status_code < 500:
                    logger.warning("Tavily rejected search request with HTTP %s.", status_code)
                    break
                logger.warning("Tavily transient HTTP %s on attempt %d.", status_code, attempt + 1)
            except ValueError as exc:
                last_error = "invalid_json"
                logger.warning("Tavily returned invalid JSON: %s", exc)
                break

            if attempt == 0:
                await asyncio.sleep(0.2)

        latency_ms = (time.perf_counter() - started_at) * 1000
        return WebSearchResponse(
            query=clean_query,
            results=[],
            error=last_error or "search_failed",
            latency_ms=latency_ms,
        )

    def _parse_results(self, raw_results: Any, *, limit: int) -> list[WebSearchResult]:
        if not isinstance(raw_results, list):
            return []

        parsed: list[WebSearchResult] = []
        seen_urls: set[str] = set()
        for raw in raw_results:
            if not isinstance(raw, dict):
                continue
            url = normalize_url(raw.get("url"))
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            title = sanitize_text(raw.get("title"), max_chars=180) or domain_from_url(url) or "Web result"
            snippet = sanitize_text(raw.get("content") or raw.get("snippet"), max_chars=self.snippet_max_chars)
            if not snippet:
                continue
            domain = domain_from_url(url)
            favicon_url = normalize_url(raw.get("favicon") or raw.get("favicon_url"))
            parsed.append(
                WebSearchResult(
                    title=title,
                    url=url,
                    snippet=snippet,
                    score=_safe_float(raw.get("score")),
                    domain=domain,
                    favicon_url=favicon_url,
                    published_date=sanitize_text(raw.get("published_date"), max_chars=40) or None,
                    metadata={"source_provider": "tavily"},
                )
            )
            if len(parsed) >= limit:
                break
        return parsed


def sanitize_query(query: str) -> str:
    return sanitize_text(query, max_chars=500)


def sanitize_text(value: Any, *, max_chars: int) -> str:
    if value is None:
        return ""
    text = _CONTROL_CHARS.sub(" ", str(value))
    text = _WHITESPACE.sub(" ", text).strip()
    return text[:max_chars].strip()


def normalize_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if len(candidate) > 2048:
        return None
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return candidate


def domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed.netloc.removeprefix("www.")


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def get_web_search_service() -> WebSearchProvider:
    return TavilySearchService()
