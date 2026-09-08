from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlsplit

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient


COMPOSE_PATH = Path(__file__).resolve().parents[2] / "docker-compose.prod.yml"
SHARED_UPLOAD_VOLUME = "omnix_uploads:/app/uploads"


def _environment(service: dict[str, Any]) -> dict[str, str]:
    raw_environment = service.get("environment") or {}
    if isinstance(raw_environment, dict):
        return {str(key): str(value) for key, value in raw_environment.items()}

    environment: dict[str, str] = {}
    for item in raw_environment:
        key, _, value = str(item).partition("=")
        environment[key] = value
    return environment


def test_production_api_and_ingestion_worker_share_upload_volume() -> None:
    compose = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))
    services = compose["services"]

    for service_name in ("backend", "ingestion-worker"):
        service = services[service_name]
        environment = _environment(service)

        assert environment["OMNIX_UPLOAD_DIR"] == "/app/uploads"
        assert environment["OMNIX_FILE_STORAGE_SHARED"].lower() == "true"
        assert SHARED_UPLOAD_VOLUME in service["volumes"]

    assert "omnix_uploads" in compose["volumes"]


def test_production_services_wait_for_backend_readiness() -> None:
    services = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))["services"]

    for name in ("nginx", "ingestion-worker", "ocr-worker", "automation-scheduler"):
        assert services[name]["depends_on"] == {
            "backend": {"condition": "service_healthy"}
        }


@pytest.mark.parametrize(
    ("storage_backend", "shared", "expected_status"),
    [("local", False, 503), ("local", True, 200), ("unsupported", True, 503)],
)
def test_compose_healthcheck_rejects_unready_storage_without_waiting_for_workers(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    storage_backend: str,
    shared: bool,
    expected_status: int,
) -> None:
    from app.health import checks, router

    services = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))["services"]
    command = services["backend"]["healthcheck"]["test"]
    assert command[:2] == ["CMD", "curl"]
    assert "-f" in command, (
        "HTTP readiness failures must fail the container healthcheck."
    )
    health_path = urlsplit(command[-1]).path

    # Keep real storage validation and readiness aggregation; isolate external services.
    async def healthy_check() -> dict[str, str]:
        return {"status": "healthy"}

    async def no_worker(*, include_stuck_jobs: bool) -> dict[str, str]:
        assert include_stuck_jobs is False
        return {"status": "no_worker"}

    for name in (
        "check_supabase",
        "check_workspace_schema_health",
        "check_vector_store",
        "check_redis",
        "check_chat_providers",
    ):
        monkeypatch.setattr(checks, name, healthy_check)
    monkeypatch.setattr(checks, "check_ingestion_worker", no_worker)
    monkeypatch.setattr(
        checks, "get_settings", lambda: SimpleNamespace(ENV="production")
    )
    monkeypatch.setenv("OMNIX_FILE_STORAGE_BACKEND", storage_backend)
    monkeypatch.setenv("OMNIX_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("OMNIX_FILE_STORAGE_SHARED", str(shared).lower())

    app = FastAPI()
    app.include_router(router.router)
    with TestClient(app) as client:
        assert client.get("/health/live").status_code == 200
        response = client.get(health_path)

    assert response.status_code == expected_status
    assert response.json() == {
        "status": "ready" if expected_status == 200 else "not_ready"
    }
