from __future__ import annotations

from collections.abc import Awaitable, Callable

import pytest


@pytest.mark.asyncio
async def test_startup_attempts_all_components_and_reports_degradation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.bootstrap import app as bootstrap_app
    from app.runtime.manager import RuntimeManager

    runtime = RuntimeManager()
    monkeypatch.setattr(RuntimeManager, "_instance", runtime)
    calls: list[str] = []

    def initializer(name: str, *, fail: bool = False) -> Callable[[], Awaitable[None]]:
        async def run() -> None:
            calls.append(name)
            if fail:
                raise ConnectionError("sensitive infrastructure detail")

        return run

    monkeypatch.setattr(bootstrap_app.redis, "initialize_redis", initializer("redis", fail=True))
    monkeypatch.setattr(bootstrap_app.observability, "initialize", initializer("observability"))
    monkeypatch.setattr(bootstrap_app.vector_store, "initialize", initializer("vector_store"))
    monkeypatch.setattr(bootstrap_app.workers, "initialize", initializer("workers"))

    app = bootstrap_app.create_app()
    await app.router.on_startup[-1]()

    assert calls == ["redis", "observability", "vector_store", "workers"]
    assert runtime.status == "degraded"
    startup = runtime.get_startup_health()
    assert startup["status"] == "degraded"
    assert startup["summary"] == {"healthy": 3, "failed": 1}
    assert startup["components"]["redis"]["error_type"] == "ConnectionError"
    assert "sensitive infrastructure detail" not in str(startup)


@pytest.mark.asyncio
async def test_startup_reports_healthy_when_every_component_initializes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.bootstrap import app as bootstrap_app
    from app.runtime.manager import RuntimeManager

    runtime = RuntimeManager()
    monkeypatch.setattr(RuntimeManager, "_instance", runtime)

    async def initialize() -> None:
        return None

    monkeypatch.setattr(bootstrap_app.redis, "initialize_redis", initialize)
    monkeypatch.setattr(bootstrap_app.observability, "initialize", initialize)
    monkeypatch.setattr(bootstrap_app.vector_store, "initialize", initialize)
    monkeypatch.setattr(bootstrap_app.workers, "initialize", initialize)

    app = bootstrap_app.create_app()
    await app.router.on_startup[-1]()

    assert runtime.status == "running"
    assert runtime.get_startup_health()["summary"] == {"healthy": 4, "failed": 0}
