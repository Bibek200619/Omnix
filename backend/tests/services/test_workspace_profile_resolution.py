from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.services import workspace_service


class MemoryRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str):
        assert ttl == 300
        self.store[key] = value


@pytest.mark.asyncio
async def test_get_profiles_populates_and_uses_redis_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    redis = MemoryRedis()

    class FakeAdmin:
        def get_user_by_id(self, user_id: str):
            calls.append(user_id)
            return SimpleNamespace(
                user=SimpleNamespace(
                    email=f"{user_id}@example.com",
                    user_metadata={"full_name": f"User {user_id[-1]}"},
                )
            )

    monkeypatch.setattr(
        workspace_service,
        "get_supabase",
        lambda: SimpleNamespace(auth=SimpleNamespace(admin=FakeAdmin())),
    )
    monkeypatch.setattr(workspace_service, "get_redis", lambda: redis, raising=False)
    async def fake_profile_map(user_ids: list[str]) -> dict[str, dict[str, object]]:
        return {}

    monkeypatch.setattr(workspace_service, "get_user_profile_map", fake_profile_map)

    profiles = await workspace_service.get_profiles([f"user-{index}" for index in range(10)])

    assert sorted(calls) == [f"user-{index}" for index in range(10)]
    assert json.loads(redis.store["omnix:profile:user-0"])["email"] == "user-0@example.com"
    assert profiles["user-0"]["full_name"] == "User 0"

    calls.clear()
    cached_profiles = await workspace_service.get_profiles([f"user-{index}" for index in range(10)])

    assert calls == []
    assert cached_profiles["user-9"]["email"] == "user-9@example.com"
