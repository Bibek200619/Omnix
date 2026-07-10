from __future__ import annotations

import pytest

from app.services.distributed_rate_limit import RateLimitExceeded, RedisRateLimiter


class FakeRedisRateLimitStore:
    def __init__(self) -> None:
        self.now_ms = 0
        self._records: dict[str, dict[str, int]] = {}

    def advance(self, seconds: float) -> None:
        self.now_ms += int(seconds * 1000)

    async def eval(self, _script: str, _key_count: int, key: str, window_ms: int) -> list[int]:
        record = self._records.get(key)
        if record is not None and record["expires_at"] <= self.now_ms:
            record = None

        if record is None:
            record = {"count": 0, "expires_at": self.now_ms + int(window_ms)}

        record["count"] += 1
        self._records[key] = record
        return [record["count"], max(0, record["expires_at"] - self.now_ms)]


@pytest.mark.asyncio
async def test_single_user_limit_rejects_request_after_limit() -> None:
    store = FakeRedisRateLimitStore()
    limiter = RedisRateLimiter(lambda: store)

    await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=2, window_seconds=60)
    await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=2, window_seconds=60)

    with pytest.raises(RateLimitExceeded) as exc_info:
        await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=2, window_seconds=60)

    assert exc_info.value.retry_after_seconds == 60


@pytest.mark.asyncio
async def test_rate_limit_is_scoped_per_workspace() -> None:
    store = FakeRedisRateLimitStore()
    limiter = RedisRateLimiter(lambda: store)

    await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=1, window_seconds=60)

    with pytest.raises(RateLimitExceeded):
        await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=1, window_seconds=60)

    await limiter.check(user_id="user-1", workspace_id="ws-2", endpoint="chat", limit=1, window_seconds=60)
    await limiter.check(user_id="user-1", workspace_id=None, endpoint="chat", limit=1, window_seconds=60)


@pytest.mark.asyncio
async def test_rate_limit_window_resets() -> None:
    store = FakeRedisRateLimitStore()
    limiter = RedisRateLimiter(lambda: store)

    await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=1, window_seconds=2)

    with pytest.raises(RateLimitExceeded):
        await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=1, window_seconds=2)

    store.advance(2.1)
    await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=1, window_seconds=2)


@pytest.mark.asyncio
async def test_multiple_limiter_instances_share_redis_state() -> None:
    store = FakeRedisRateLimitStore()
    limiter_a = RedisRateLimiter(lambda: store)
    limiter_b = RedisRateLimiter(lambda: store)

    await limiter_a.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=1, window_seconds=60)

    with pytest.raises(RateLimitExceeded):
        await limiter_b.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=1, window_seconds=60)


@pytest.mark.asyncio
async def test_streaming_endpoint_has_independent_distributed_limit() -> None:
    store = FakeRedisRateLimitStore()
    limiter = RedisRateLimiter(lambda: store)

    await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat", limit=1, window_seconds=60)
    await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat.stream", limit=1, window_seconds=60)

    with pytest.raises(RateLimitExceeded):
        await limiter.check(user_id="user-1", workspace_id="ws-1", endpoint="chat.stream", limit=1, window_seconds=60)
