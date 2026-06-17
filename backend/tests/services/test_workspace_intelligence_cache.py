from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.services import workspace_intelligence_service as intelligence


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}
        self.deleted: list[str] = []
        self.published: list[tuple[str, str]] = []

    async def get(self, key: str) -> str | None:
        return self.values.get(str(key))

    async def setex(self, key: str, ttl: int | float, value: str) -> None:
        key = str(key)
        self.values[key] = value
        self.ttls[key] = int(ttl)

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self.deleted.append(str(key))
            self.values.pop(str(key), None)
            self.ttls.pop(str(key), None)

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, payload))

    async def scan_iter(self, match: str):
        prefix = match.rstrip("*")
        for key in list(self.values):
            if key.startswith(prefix):
                yield key


@pytest.fixture(autouse=True)
def clear_intelligence_cache():
    intelligence._intelligence_profile_cache.clear()
    yield
    intelligence._intelligence_profile_cache.clear()


@pytest.mark.asyncio
async def test_workspace_intelligence_profile_is_cached_in_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    workspace = {
        "id": "workspace-1",
        "name": "Engineering",
        "workspace_type": "super_workspace",
        "workspace_focus": "engineering",
        "ai_specialization": "engineering",
        "intelligence_preferences": {},
    }

    async def allow_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace=workspace)

    async def fake_scope_ids(workspace_payload: dict[str, Any], user_id: str) -> list[str]:
        return ["workspace-1"]

    async def fake_select(*args, **kwargs) -> list[dict[str, Any]]:
        return []

    async def fake_members(workspace_payload: dict[str, Any]) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(intelligence, "get_redis", lambda: redis, raising=False)
    monkeypatch.setattr(intelligence, "require_workspace_access", allow_access)
    monkeypatch.setattr(intelligence, "workspace_retrieval_scope_ids", fake_scope_ids)
    monkeypatch.setattr(intelligence, "_optional_select_all", fake_select)
    monkeypatch.setattr(intelligence, "list_workspace_members", fake_members)

    profile = await intelligence.build_workspace_intelligence_profile("workspace-1", "user-1")

    key = "omnix:intelligence:workspace-1:user-1"
    assert profile["workspace_focus"] == "engineering"
    assert redis.ttls[key] == 60
    assert key in redis.values


@pytest.mark.asyncio
async def test_invalidate_workspace_intelligence_cache_clears_local_and_publishes(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    redis.values["omnix:intelligence:workspace-1:user-1"] = "{}"
    intelligence._intelligence_profile_cache[("workspace-1", "user-1")] = (1.0, {"stale": True})

    monkeypatch.setattr(intelligence, "get_redis", lambda: redis, raising=False)

    await intelligence.invalidate_workspace_intelligence_cache("workspace-1")

    assert ("workspace-1", "user-1") not in intelligence._intelligence_profile_cache
    assert "omnix:intelligence:workspace-1:user-1" in redis.deleted
    assert redis.published
    assert redis.published[0][0] == "omnix:cache:invalidate"
