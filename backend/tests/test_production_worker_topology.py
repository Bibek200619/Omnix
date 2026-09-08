from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_PATH = REPO_ROOT / "docker-compose.prod.yml"
WORKER_SCRIPT_PATH = REPO_ROOT / "scripts" / "start_workers.sh"
SYSTEMD_UNIT_PATH = REPO_ROOT / "scripts" / "omnix-ingestion-worker.service"


def _environment(service: dict[str, Any]) -> dict[str, str]:
    raw_environment = service.get("environment") or {}
    if isinstance(raw_environment, dict):
        return {str(key): str(value) for key, value in raw_environment.items()}

    environment: dict[str, str] = {}
    for item in raw_environment:
        key, _, value = str(item).partition("=")
        environment[key] = value
    return environment


def test_production_worker_scaling_targets_declared_ingestion_service() -> None:
    compose = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))
    services = compose["services"]
    script = WORKER_SCRIPT_PATH.read_text(encoding="utf-8")

    scale_match = re.search(r"--scale\s+([A-Za-z0-9_-]+)=", script)
    detached_service_match = re.search(r"\s-d\s+([A-Za-z0-9_-]+)", script)

    assert scale_match, "The production worker script must declare a Compose scale target."
    assert detached_service_match, "The production worker script must start the scaled Compose service."

    scale_target = scale_match.group(1)
    started_target = detached_service_match.group(1)

    assert scale_target == started_target == "ingestion-worker"
    assert scale_target in services

    ingestion_worker = services[scale_target]
    assert ingestion_worker["command"] == ["python", "-m", "app.jobs.worker"]
    assert _environment(ingestion_worker)["OMNIX_ROLE"] == "ingestion_worker"


def test_production_systemd_unit_uses_the_compose_ingestion_worker_role() -> None:
    unit = SYSTEMD_UNIT_PATH.read_text(encoding="utf-8")

    assert "Environment=OMNIX_ROLE=ingestion_worker" in unit
    assert "-m app.jobs.worker" in unit
