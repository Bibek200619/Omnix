from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.db import supabase_client


class DummyClient:
    def table(self, name: str) -> str:
        return name


@pytest.mark.asyncio
async def test_async_supabase_singleton_is_awaited_and_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    client = DummyClient()

    async def fake_create_async_client(*args, **kwargs):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return client

    monkeypatch.setattr(supabase_client, "_async_supabase_client", None)
    monkeypatch.setattr(supabase_client, "_async_http_client", None)
    monkeypatch.setattr(
        supabase_client,
        "get_settings",
        lambda: SimpleNamespace(
            supabase_base_url="https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY="service-role",
        ),
    )
    monkeypatch.setattr(supabase_client, "create_async_client", fake_create_async_client)

    clients = await asyncio.gather(*(supabase_client.get_async_supabase() for _ in range(20)))

    assert calls == 1
    assert all(item is client for item in clients)
    assert clients[0].table("workspaces") == "workspaces"

    await supabase_client.close_async_supabase()


@pytest.mark.asyncio
async def test_async_supabase_factory_awaits_returned_coroutine(monkeypatch: pytest.MonkeyPatch) -> None:
    client = DummyClient()

    async def build_client() -> DummyClient:
        return client

    def fake_create_async_client(*args, **kwargs):
        return build_client()

    monkeypatch.setattr(supabase_client, "_async_supabase_client", None)
    monkeypatch.setattr(supabase_client, "_async_http_client", None)
    monkeypatch.setattr(
        supabase_client,
        "get_settings",
        lambda: SimpleNamespace(
            supabase_base_url="https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY="service-role",
        ),
    )
    monkeypatch.setattr(supabase_client, "create_async_client", fake_create_async_client)

    resolved = await supabase_client.get_async_supabase()

    assert resolved is client
    assert not asyncio.iscoroutine(resolved)

    await supabase_client.close_async_supabase()
