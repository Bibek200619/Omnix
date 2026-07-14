from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


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
