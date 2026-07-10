from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.health import checks


def _base_checks() -> dict[str, Any]:
    return {
        "supabase": {"status": "healthy"},
        "workspace_schema": {"status": "healthy", "summary": "Schema verified."},
        "redis": {"status": "healthy", "ping": "True"},
        "vector_store": {"status": "healthy", "type": "PgVectorStore"},
        "ollama": {
            "status": "healthy",
            "primary": "ollama",
            "configured": ["ollama"],
            "providers": {"ollama": {"status": "healthy", "probe": "live", "model": "phi3:mini"}},
            "reason": None,
        },
        "ingestion_worker": {
            "status": "healthy",
            "active_workers": 1,
            "queue_depth": 0,
            "processing_jobs": 0,
            "completed_jobs": 4,
            "failed_jobs": 0,
            "queue_recovery": {"status": "clear", "missing_jobs": 0, "requeued_jobs": 0},
            "dead_lettered_jobs": 0,
        },
    }


def _api_logging_health() -> dict[str, Any]:
    return {
        "status": "healthy",
        "pending_tasks": 0,
        "max_pending_tasks": 100,
        "enqueued_total": 4,
        "written_total": 4,
        "failed_total": 0,
        "dropped_total": 0,
        "last_failure_at": None,
        "last_drop_at": None,
    }


def _startup_health() -> dict[str, Any]:
    return {
        "status": "healthy",
        "summary": {"healthy": 4, "failed": 0},
        "components": {
            name: {"status": "healthy"}
            for name in ("redis", "observability", "vector_store", "workers")
        },
    }


def test_operational_health_contains_required_components() -> None:
    result = checks.build_operational_health(
        _base_checks(),
        embedding_provider={"status": "healthy", "provider": "LocalEmbeddingProvider"},
        file_storage={"status": "healthy", "backend": "local", "shared": False},
        api_logging=_api_logging_health(),
        startup=_startup_health(),
    )

    assert result["status"] == "healthy"
    assert result["summary"] == {"healthy": 12, "warning": 0, "degraded": 0, "failed": 0}
    assert {
        "redis",
        "workers",
        "vector_store",
        "embedding_provider",
        "file_storage",
        "queue_recovery",
        "dead_letters",
    }.issubset(result["components"])


def test_operational_health_distinguishes_warning_and_degraded_states() -> None:
    raw_checks = _base_checks()
    raw_checks["ingestion_worker"] = {
        **raw_checks["ingestion_worker"],
        "status": "no_worker",
        "active_workers": 0,
        "queue_depth": 3,
        "queue_recovery": {"status": "recovery_needed", "missing_jobs": 2},
        "dead_lettered_jobs": 1,
    }

    startup = _startup_health()
    startup["status"] = "degraded"
    startup["summary"] = {"healthy": 3, "failed": 1}
    startup["components"]["redis"] = {"status": "failed", "error_type": "ConnectionError"}

    result = checks.build_operational_health(
        raw_checks,
        embedding_provider={"status": "healthy", "provider": "LocalEmbeddingProvider"},
        file_storage={"status": "warning", "backend": "local", "reason": "local_storage_not_shared"},
        api_logging=_api_logging_health(),
        startup=startup,
    )

    assert result["status"] == "degraded"
    assert result["components"]["workers"]["status"] == "degraded"
    assert result["components"]["queue_recovery"]["status"] == "degraded"
    assert result["components"]["dead_letters"] == {"status": "degraded", "count": 1}
    assert result["components"]["file_storage"]["status"] == "warning"
    assert result["components"]["startup"]["status"] == "degraded"


def test_operational_health_marks_failed_dependencies() -> None:
    raw_checks = _base_checks()
    raw_checks["redis"] = {"status": "unhealthy", "error": "connection refused"}

    result = checks.build_operational_health(
        raw_checks,
        embedding_provider={"status": "healthy", "provider": "LocalEmbeddingProvider"},
        file_storage={"status": "healthy", "backend": "supabase", "shared": True},
        api_logging=_api_logging_health(),
        startup=_startup_health(),
    )

    assert result["status"] == "failed"
    assert result["components"]["redis"] == {"status": "failed", "observed_status": "unhealthy"}


@pytest.mark.asyncio
async def test_operational_health_route_returns_structured_result(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.health import router

    expected = {"status": "warning", "summary": {}, "components": {}}

    async def fake_operational_checks() -> dict[str, Any]:
        return expected

    monkeypatch.setattr(router, "run_operational_checks", fake_operational_checks)

    assert await router.operational_health(current_user={"sub": "admin-1"}) == expected


@pytest.mark.asyncio
async def test_chat_provider_health_reports_configured_failover_as_degraded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failed_ollama() -> dict[str, Any]:
        return {"status": "unhealthy", "error": "connection refused", "expected_model": "phi3:mini"}

    monkeypatch.setattr(checks, "check_ollama", failed_ollama)
    monkeypatch.setattr(
        checks,
        "get_settings",
        lambda: SimpleNamespace(
            AI_PROVIDER_ORDER="ollama,openai,anthropic",
            OPENAI_API_KEY="configured",
            ANTHROPIC_API_KEY=None,
        ),
    )

    result = await checks.check_chat_providers()

    assert result["status"] == "degraded"
    assert result["configured"] == ["ollama", "openai"]
    assert result["providers"]["ollama"]["status"] == "failed"
    assert "connection refused" not in str(result)


@pytest.mark.asyncio
async def test_chat_provider_health_fails_without_configured_failover(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failed_ollama() -> dict[str, Any]:
        return {"status": "unhealthy", "error": "connection refused", "expected_model": "phi3:mini"}

    monkeypatch.setattr(checks, "check_ollama", failed_ollama)
    monkeypatch.setattr(
        checks,
        "get_settings",
        lambda: SimpleNamespace(
            AI_PROVIDER_ORDER="ollama,openai,anthropic",
            OPENAI_API_KEY=None,
            ANTHROPIC_API_KEY=None,
        ),
    )

    result = await checks.check_chat_providers()

    assert result["status"] == "failed"
    assert result["reason"] == "no_chat_provider_available"


@pytest.mark.asyncio
async def test_chat_provider_health_warns_for_unprobed_remote_primary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def healthy_ollama() -> dict[str, Any]:
        return {"status": "healthy", "model": "phi3:mini"}

    monkeypatch.setattr(checks, "check_ollama", healthy_ollama)
    monkeypatch.setattr(
        checks,
        "get_settings",
        lambda: SimpleNamespace(
            AI_PROVIDER_ORDER="openai,ollama",
            OPENAI_API_KEY="configured",
            ANTHROPIC_API_KEY=None,
        ),
    )

    result = await checks.check_chat_providers()

    assert result["status"] == "warning"
    assert result["primary"] == "openai"
    assert result["reason"] == "primary_connectivity_not_probed"


@pytest.mark.asyncio
async def test_readiness_allows_explicit_warning_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.health import router

    async def warning_checks(*, include_internal: bool) -> dict[str, Any]:
        assert include_internal is False
        return {"chat_provider": {"status": "warning"}}

    monkeypatch.setattr(router, "run_all_checks", warning_checks)

    assert await router.readiness_check() == {
        "status": "ready",
        "checks": {"chat_provider": {"status": "warning"}},
    }
