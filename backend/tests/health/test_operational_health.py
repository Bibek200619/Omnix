from __future__ import annotations

from typing import Any

import pytest

from app.health import checks


def _base_checks() -> dict[str, Any]:
    return {
        "supabase": {"status": "healthy"},
        "workspace_schema": {"status": "healthy", "summary": "Schema verified."},
        "redis": {"status": "healthy", "ping": "True"},
        "vector_store": {"status": "healthy", "type": "PgVectorStore"},
        "ollama": {"status": "healthy", "model": "phi3:mini"},
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


def test_operational_health_contains_required_components() -> None:
    result = checks.build_operational_health(
        _base_checks(),
        embedding_provider={"status": "healthy", "provider": "LocalEmbeddingProvider"},
        file_storage={"status": "healthy", "backend": "local", "shared": False},
        api_logging=_api_logging_health(),
    )

    assert result["status"] == "healthy"
    assert result["summary"] == {"healthy": 11, "warning": 0, "degraded": 0, "failed": 0}
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

    result = checks.build_operational_health(
        raw_checks,
        embedding_provider={"status": "healthy", "provider": "LocalEmbeddingProvider"},
        file_storage={"status": "warning", "backend": "local", "reason": "local_storage_not_shared"},
        api_logging=_api_logging_health(),
    )

    assert result["status"] == "degraded"
    assert result["components"]["workers"]["status"] == "degraded"
    assert result["components"]["queue_recovery"]["status"] == "degraded"
    assert result["components"]["dead_letters"] == {"status": "degraded", "count": 1}
    assert result["components"]["file_storage"]["status"] == "warning"


def test_operational_health_marks_failed_dependencies() -> None:
    raw_checks = _base_checks()
    raw_checks["redis"] = {"status": "unhealthy", "error": "connection refused"}

    result = checks.build_operational_health(
        raw_checks,
        embedding_provider={"status": "healthy", "provider": "LocalEmbeddingProvider"},
        file_storage={"status": "healthy", "backend": "supabase", "shared": True},
        api_logging=_api_logging_health(),
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
