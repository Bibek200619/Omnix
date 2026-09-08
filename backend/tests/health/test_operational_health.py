from __future__ import annotations

import json
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
        "backpressured_total": 0,
        "last_failure_at": None,
        "last_backpressure_at": None,
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
    assert result["components"]["api_logging"]["backpressured_total"] == 0


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
async def test_production_local_storage_without_shared_contract_fails_health(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", "local")
    monkeypatch.setenv("OMNIX_UPLOAD_DIR", str(tmp_path))
    monkeypatch.delenv("OMNIX_FILE_STORAGE_SHARED", raising=False)
    monkeypatch.setattr(checks, "get_settings", lambda: SimpleNamespace(ENV="production"))

    result = await checks.check_file_storage()

    assert result["status"] == "failed"
    assert result["shared"] is False
    assert result["reason"] == "local_storage_not_shared"


@pytest.mark.asyncio
async def test_production_explicit_shared_local_storage_is_healthy(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", "local")
    monkeypatch.setenv("OMNIX_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("OMNIX_FILE_STORAGE_SHARED", "true")
    monkeypatch.setattr(checks, "get_settings", lambda: SimpleNamespace(ENV="production"))

    result = await checks.check_file_storage()

    assert result["status"] == "healthy"
    assert result["shared"] is True


@pytest.mark.asyncio
async def test_run_all_checks_includes_file_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    async def healthy_check() -> dict[str, Any]:
        return {"status": "healthy"}

    async def healthy_worker(*, include_stuck_jobs: bool) -> dict[str, Any]:
        assert include_stuck_jobs is False
        return {"status": "healthy"}

    storage_result = {"status": "failed", "reason": "local_storage_not_shared"}

    async def failed_storage() -> dict[str, Any]:
        return storage_result

    monkeypatch.setattr(checks, "check_supabase", healthy_check)
    monkeypatch.setattr(checks, "check_workspace_schema_health", healthy_check)
    monkeypatch.setattr(checks, "check_vector_store", healthy_check)
    monkeypatch.setattr(checks, "check_redis", healthy_check)
    monkeypatch.setattr(checks, "check_chat_providers", healthy_check)
    monkeypatch.setattr(checks, "check_ingestion_worker", healthy_worker)
    monkeypatch.setattr(checks, "check_file_storage", failed_storage)

    result = await checks.run_all_checks(include_internal=False)

    assert result["file_storage"] == storage_result


@pytest.mark.asyncio
async def test_readiness_includes_and_rejects_failed_file_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.health import router

    async def failed_storage_checks(*, include_internal: bool) -> dict[str, Any]:
        assert include_internal is False
        return {"file_storage": {"status": "failed", "reason": "local_storage_not_shared"}}

    monkeypatch.setattr(router, "run_all_checks", failed_storage_checks)

    response = await router.readiness_check()

    assert response.status_code == 503
    assert json.loads(response.body) == {"status": "not_ready"}


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

    assert await router.readiness_check() == {"status": "ready"}
