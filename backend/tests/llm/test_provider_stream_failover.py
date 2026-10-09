from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import pytest

from app.services.chat_service import ModelServiceError, ProviderManager


class Provider:
    def __init__(
        self, tokens: list[str], *, delay: float = 0, error: Exception | None = None
    ) -> None:
        self.tokens = tokens
        self.delay = delay
        self.error = error
        self.called = False
        self.closed = False

    async def stream(self, *args, **kwargs) -> AsyncGenerator[str, None]:
        self.called = True
        try:
            for token in self.tokens:
                if self.delay:
                    await asyncio.sleep(self.delay)
                yield token
            if self.error:
                raise self.error
        finally:
            self.closed = True


def manager(
    primary: Provider, backup: Provider, *, timeout: float = 0.1
) -> ProviderManager:
    return ProviderManager(
        providers={"ollama": primary, "openai": backup},
        provider_order=["ollama", "openai"],
        failover_latency_threshold=timeout,
        request_timeout=timeout,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("tokens", [[], [""], ["", ""]])
async def test_empty_primary_tries_backup(tokens: list[str]) -> None:
    primary, backup = Provider(tokens), Provider(["backup", " answer"])
    assert [token async for token in manager(primary, backup).stream("prompt")] == [
        "backup",
        " answer",
    ]
    assert primary.closed and backup.closed


@pytest.mark.asyncio
async def test_empty_prefix_is_not_content_and_does_not_force_failover() -> None:
    primary, backup = Provider(["", "", "real", "", " content"]), Provider(["backup"])
    assert [token async for token in manager(primary, backup).stream("prompt")] == [
        "real",
        " content",
    ]
    assert primary.closed and not backup.called


@pytest.mark.asyncio
async def test_all_empty_providers_raise_unavailable() -> None:
    primary, backup = Provider([]), Provider([""])
    with pytest.raises(ModelServiceError) as exc:
        _ = [token async for token in manager(primary, backup).stream("prompt")]
    assert exc.value.status_code == 503
    assert primary.closed and backup.closed


@pytest.mark.asyncio
async def test_empty_tokens_do_not_reset_first_content_deadline() -> None:
    primary, backup = Provider([""] * 100, delay=0.005), Provider(["backup"])
    assert [
        token async for token in manager(primary, backup, timeout=0.02).stream("prompt")
    ] == ["backup"]
    assert primary.closed and backup.closed


@pytest.mark.asyncio
async def test_error_after_empty_prefix_can_failover() -> None:
    primary = Provider([""], error=ModelServiceError("unavailable", 503))
    backup = Provider(["backup"])
    assert [token async for token in manager(primary, backup).stream("prompt")] == [
        "backup"
    ]
    assert primary.closed and backup.closed


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error", [ModelServiceError("unavailable", 503), asyncio.TimeoutError()]
)
async def test_error_after_content_never_combines_provider_answers(
    error: Exception,
) -> None:
    primary, backup = Provider(["partial"], error=error), Provider(["backup"])
    output: list[str] = []
    with pytest.raises(ModelServiceError):
        async for token in manager(primary, backup).stream("prompt"):
            output.append(token)
    assert output == ["partial"]
    assert primary.closed and not backup.called


@pytest.mark.asyncio
async def test_consumer_closing_stream_closes_provider() -> None:
    primary, backup = Provider(["first", "second"]), Provider(["backup"])
    stream = manager(primary, backup).stream("prompt")
    assert await anext(stream) == "first"
    await stream.aclose()
    assert primary.closed and not backup.called


@pytest.mark.asyncio
async def test_cancelled_request_closes_provider_without_starting_backup() -> None:
    primary, backup = Provider(["late"], delay=10), Provider(["backup"])
    stream = manager(primary, backup, timeout=1).stream("prompt")
    waiting = asyncio.create_task(anext(stream))
    # Yield until the provider is waiting in its first-content request.
    while not primary.called:
        await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert primary.closed and not backup.called


@pytest.mark.asyncio
async def test_cleanup_failure_is_redacted_and_does_not_mask_consumer_close(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class Iterator:
        def __aiter__(self):
            return self

        async def __anext__(self):
            return "content"

        async def aclose(self):
            raise RuntimeError("private-provider-marker")

    class CleanupFailureProvider:
        def stream(self, *args, **kwargs):
            return Iterator()

    backup = Provider(["backup"])
    service = ProviderManager(
        providers={"ollama": CleanupFailureProvider(), "openai": backup},
        provider_order=["ollama", "openai"],
    )
    stream = service.stream("prompt")
    assert await anext(stream) == "content"
    await stream.aclose()
    assert "cleanup failed" in caplog.text
    assert "private-provider-marker" not in caplog.text
    assert not backup.called
