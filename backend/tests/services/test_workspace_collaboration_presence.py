from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from app.services import workspace_collaboration_service as collaboration


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}
        self.deleted: list[str] = []

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

    async def scan_iter(self, match: str):
        prefix = match.rstrip("*")
        for key in list(self.values):
            if key.startswith(prefix):
                yield key


@pytest.fixture(autouse=True)
def clear_presence_cache():
    collaboration._local_snapshot_cache.clear()
    yield
    collaboration._local_snapshot_cache.clear()


@pytest.mark.asyncio
async def test_heartbeat_sets_per_user_presence_key_with_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    persisted: list[dict[str, Any]] = []

    async def allow_access(workspace_id: str, user_id: str) -> None:
        return None

    async def fake_upsert(table: str, payload: dict[str, Any], on_conflict: str):
        persisted.append(payload)
        return payload

    async def fake_list(workspace_id: str, user_id: str) -> dict[str, Any]:
        return {"workspace_id": workspace_id, "online_count": 1, "online_members": []}

    monkeypatch.setattr(collaboration, "get_redis", lambda: redis)
    monkeypatch.setattr(collaboration, "require_workspace_access", allow_access)
    monkeypatch.setattr(collaboration, "upsert_one", fake_upsert)
    monkeypatch.setattr(collaboration, "list_workspace_presence", fake_list)

    await collaboration.heartbeat_workspace_presence(
        workspace_id="workspace-1",
        user_id="user-1",
        current_view="chat",
        current_label="General",
    )

    key = "omnix:presence:workspace-1:user-1"
    assert redis.ttls[key] == 150
    assert json.loads(redis.values[key])["status"] == "online"
    assert persisted[0]["user_id"] == "user-1"


@pytest.mark.asyncio
async def test_list_workspace_presence_reads_live_redis_entries_first(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    timestamp = datetime.now(timezone.utc).isoformat()
    redis.values["omnix:presence:workspace-1:user-1"] = json.dumps(
        {
            "workspace_id": "workspace-1",
            "user_id": "user-1",
            "status": "online",
            "current_view": "chat",
            "current_label": "General",
            "metadata": {},
            "last_seen_at": timestamp,
            "updated_at": timestamp,
        }
    )
    redis.ttls["omnix:presence:workspace-1:user-1"] = 150

    async def allow_access(workspace_id: str, user_id: str) -> None:
        return None

    async def fail_select(*args, **kwargs):
        pytest.fail("live Redis presence should be used before Postgres fallback")

    async def fake_profiles(user_ids: list[str]) -> dict[str, dict[str, Any]]:
        return {"user-1": {"full_name": "Ada Lovelace", "email": "ada@example.com"}}

    monkeypatch.setattr(collaboration, "get_redis", lambda: redis)
    monkeypatch.setattr(collaboration, "require_workspace_access", allow_access)
    monkeypatch.setattr(collaboration, "select_all_trusted", fail_select)
    monkeypatch.setattr(collaboration, "get_profiles", fake_profiles)

    result = await collaboration.list_workspace_presence(workspace_id="workspace-1", user_id="user-1")

    assert result["online_count"] == 1
    assert result["active_count"] == 1
    assert result["online_members"][0]["user_id"] == "user-1"
    assert result["online_members"][0]["full_name"] == "Ada Lovelace"
