from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import yaml

from app.bootstrap import middleware, redis, shutdown


@pytest.mark.asyncio
async def test_api_log_shutdown_drain_waits_for_pending_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def pending_write() -> None:
        started.set()
        await release.wait()

    task = asyncio.create_task(pending_write())
    monkeypatch.setattr(middleware, "_background_tasks", {task})
    await started.wait()

    drain = asyncio.create_task(middleware.drain_api_log_tasks(timeout_seconds=1))
    await asyncio.sleep(0)
    assert drain.done() is False

    release.set()
    assert await drain == (1, 0)
    assert middleware._background_tasks == set()


@pytest.mark.asyncio
async def test_api_log_shutdown_drain_cancels_timed_out_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def stuck_write() -> None:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    task = asyncio.create_task(stuck_write())
    monkeypatch.setattr(middleware, "_background_tasks", {task})
    await started.wait()

    assert await middleware.drain_api_log_tasks(timeout_seconds=0) == (0, 1)
    assert task.cancelled() is True
    assert cancelled.is_set()
    assert middleware._background_tasks == set()


@pytest.mark.asyncio
async def test_close_redis_is_idempotent_and_does_not_create_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = SimpleNamespace(aclose=AsyncMock())
    build_client = AsyncMock()
    monkeypatch.setattr(redis, "_redis_client", client)
    monkeypatch.setattr(redis, "_build_redis_client", build_client)

    await redis.close_redis()
    await redis.close_redis()

    client.aclose.assert_awaited_once_with()
    build_client.assert_not_awaited()
    assert redis._redis_client is None


@pytest.mark.asyncio
async def test_graceful_shutdown_drains_and_closes_owned_resources_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[object] = []
    runtime = SimpleNamespace(set_status=lambda status: events.append(("status", status)))

    async def drain(*, timeout_seconds: float) -> tuple[int, int]:
        events.append(("drain", timeout_seconds))
        return 2, 0

    async def close(name: str) -> None:
        events.append(name)

    monkeypatch.setattr(shutdown, "RuntimeManager", SimpleNamespace(get=lambda: runtime))
    monkeypatch.setattr(shutdown, "drain_api_log_tasks", drain)
    monkeypatch.setattr(shutdown, "shutdown_vector_store", lambda: close("vector"))
    monkeypatch.setattr(shutdown, "close_async_supabase", lambda: close("supabase"))
    monkeypatch.setattr(shutdown, "close_redis", lambda: close("redis"))

    await shutdown.graceful_shutdown(api_log_drain_timeout_seconds=3.5)

    assert events == [
        ("status", "shutting_down"),
        ("drain", 3.5),
        "vector",
        "supabase",
        "redis",
        ("status", "terminated"),
    ]


@pytest.mark.asyncio
async def test_graceful_shutdown_isolates_cleanup_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    statuses: list[str] = []
    runtime = SimpleNamespace(set_status=statuses.append)

    async def failed_drain(*, timeout_seconds: float) -> tuple[int, int]:
        raise RuntimeError(f"drain failed after {timeout_seconds}")

    async def close(name: str) -> None:
        events.append(name)

    monkeypatch.setattr(shutdown, "RuntimeManager", SimpleNamespace(get=lambda: runtime))
    monkeypatch.setattr(shutdown, "drain_api_log_tasks", failed_drain)
    monkeypatch.setattr(shutdown, "shutdown_vector_store", lambda: close("vector"))
    monkeypatch.setattr(shutdown, "close_async_supabase", lambda: close("supabase"))
    monkeypatch.setattr(shutdown, "close_redis", lambda: close("redis"))

    await shutdown.graceful_shutdown(api_log_drain_timeout_seconds=0.01)

    assert events == ["vector", "supabase", "redis"]
    assert statuses == ["shutting_down", "terminated"]


def test_container_grace_window_covers_request_and_log_drains() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    compose = yaml.safe_load((repo_root / "docker-compose.prod.yml").read_text())
    backend = compose["services"]["backend"]
    command = backend["command"]

    flag_index = command.index("--timeout-graceful-shutdown")
    request_drain_seconds = int(command[flag_index + 1])
    container_grace_seconds = int(str(backend["stop_grace_period"]).removesuffix("s"))

    assert request_drain_seconds == 30
    assert container_grace_seconds >= request_drain_seconds + 10 + 5

    dockerfile = (repo_root / "backend" / "Dockerfile.backend").read_text()
    assert '"--timeout-graceful-shutdown", "30"' in dockerfile
