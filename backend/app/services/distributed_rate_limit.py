from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import hashlib
import logging
import math
from typing import Any

from ..bootstrap.redis import get_redis

logger = logging.getLogger(__name__)

DEFAULT_RATE_LIMIT_REQUESTS = 5
DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60.0

_RATE_LIMIT_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
"""


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    count: int
    remaining: int
    retry_after_seconds: int
    reset_after_seconds: int


class RateLimitExceeded(RuntimeError):
    def __init__(self, decision: RateLimitDecision) -> None:
        super().__init__("Rate limit exceeded")
        self.decision = decision
        self.retry_after_seconds = decision.retry_after_seconds


class RateLimitUnavailable(RuntimeError):
    pass


def _coerce_int(value: Any) -> int:
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    return int(value)


def _endpoint_key(endpoint: str) -> str:
    normalized = endpoint.strip().lower().replace("/", ".").replace(":", ".")
    return "".join(char if char.isalnum() or char in {"-", "."} else "-" for char in normalized) or "unknown"


def rate_limit_key(
    *,
    user_id: str,
    workspace_id: str | None,
    endpoint: str,
    key_prefix: str = "omnix:rate-limit",
) -> str:
    endpoint_part = _endpoint_key(endpoint)
    workspace_part = workspace_id or "personal"
    digest = hashlib.sha256(f"{user_id}\x1f{workspace_part}\x1f{endpoint_part}".encode("utf-8")).hexdigest()
    return f"{key_prefix}:{endpoint_part}:{digest[:32]}"


class RedisRateLimiter:
    def __init__(
        self,
        redis_getter: Callable[[], Any] = get_redis,
        *,
        key_prefix: str = "omnix:rate-limit",
    ) -> None:
        self._redis_getter = redis_getter
        self._key_prefix = key_prefix

    async def check(
        self,
        *,
        user_id: str,
        workspace_id: str | None,
        endpoint: str,
        limit: int = DEFAULT_RATE_LIMIT_REQUESTS,
        window_seconds: float = DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    ) -> RateLimitDecision:
        bounded_limit = max(1, int(limit))
        bounded_window_seconds = max(1.0, float(window_seconds))
        window_ms = int(math.ceil(bounded_window_seconds * 1000))
        key = rate_limit_key(
            user_id=user_id,
            workspace_id=workspace_id,
            endpoint=endpoint,
            key_prefix=self._key_prefix,
        )

        try:
            redis = self._redis_getter()
            raw_result = await redis.eval(_RATE_LIMIT_SCRIPT, 1, key, window_ms)
        except Exception as exc:
            logger.warning("Distributed rate-limit check failed for endpoint=%s", endpoint, exc_info=True)
            raise RateLimitUnavailable("Distributed rate limiter is unavailable") from exc

        try:
            count = _coerce_int(raw_result[0])
            ttl_ms = _coerce_int(raw_result[1])
        except Exception as exc:
            logger.warning("Unexpected Redis rate-limit response for endpoint=%s: %r", endpoint, raw_result)
            raise RateLimitUnavailable("Distributed rate limiter returned an invalid response") from exc

        if ttl_ms < 0:
            ttl_ms = window_ms

        reset_after_seconds = max(1, int(math.ceil(ttl_ms / 1000)))
        decision = RateLimitDecision(
            allowed=count <= bounded_limit,
            limit=bounded_limit,
            count=count,
            remaining=max(0, bounded_limit - count),
            retry_after_seconds=reset_after_seconds,
            reset_after_seconds=reset_after_seconds,
        )
        if not decision.allowed:
            raise RateLimitExceeded(decision)
        return decision


_default_rate_limiter = RedisRateLimiter()


async def enforce_rate_limit(
    *,
    user_id: str,
    workspace_id: str | None,
    endpoint: str,
    limit: int = DEFAULT_RATE_LIMIT_REQUESTS,
    window_seconds: float = DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
) -> RateLimitDecision:
    return await _default_rate_limiter.check(
        user_id=user_id,
        workspace_id=workspace_id,
        endpoint=endpoint,
        limit=limit,
        window_seconds=window_seconds,
    )
