from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


COMPOSE_PATH = Path(__file__).resolve().parents[2] / "docker-compose.yml"


def _environment(service: dict[str, Any]) -> dict[str, str]:
    raw_environment = service.get("environment") or {}
    if isinstance(raw_environment, dict):
        return {str(key): str(value) for key, value in raw_environment.items()}

    environment: dict[str, str] = {}
    for item in raw_environment:
        key, _, value = str(item).partition("=")
        environment[key] = value
    return environment


def test_development_compose_matches_production_worker_roles() -> None:
    compose = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))
    services = compose["services"]

    assert "worker" not in services
    assert _environment(services["backend"])["OMNIX_ROLE"] == "api"

    ingestion = services["ingestion-worker"]
    assert ingestion["command"] == ["python", "-m", "app.jobs.worker"]
    assert _environment(ingestion)["OMNIX_ROLE"] == "ingestion_worker"
    assert "SUPABASE_SERVICE_ROLE_KEY" in _environment(ingestion)
    assert "./backend:/app" in ingestion["volumes"]

    scheduler = services["automation-scheduler"]
    assert scheduler["command"] == ["python", "-m", "app.automation.scheduler"]
    assert _environment(scheduler)["OMNIX_ROLE"] == "automation_scheduler"
    assert "SUPABASE_SERVICE_ROLE_KEY" in _environment(scheduler)
