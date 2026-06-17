from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.routers import messages


class MemoryRedis:
    def __init__(self) -> None:
        self.store: dict[str, int] = {}
        self.expirations: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    async def expire(self, key: str, seconds: int) -> bool:
        self.expirations[key] = seconds
        return True


@pytest.mark.asyncio
async def test_rate_limit_uses_redis_minute_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = MemoryRedis()
    bucket = 12345
    monkeypatch.setenv("OMNIX_RATE_LIMIT_RPM", "30")
    monkeypatch.setattr(messages, "get_redis", lambda: redis, raising=False)
    monkeypatch.setattr(messages, "_current_minute_bucket", lambda: bucket, raising=False)

    for _ in range(30):
        await messages._check_rate_limit("user-1")

    blocked = 0
    for _ in range(5):
        with pytest.raises(HTTPException) as exc_info:
            await messages._check_rate_limit("user-1")
        assert exc_info.value.status_code == 429
        blocked += 1

    assert blocked == 5
    assert redis.store["omnix:ratelimit:user-1:12345"] == 35
    assert redis.expirations["omnix:ratelimit:user-1:12345"] == 60

    bucket = 12346
    await messages._check_rate_limit("user-1")
    assert redis.store["omnix:ratelimit:user-1:12346"] == 1
