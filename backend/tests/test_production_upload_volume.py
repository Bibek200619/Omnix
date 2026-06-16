from __future__ import annotations

from pathlib import Path

import yaml


def test_production_api_and_ingestion_worker_share_upload_volume() -> None:
    compose_path = Path(__file__).resolve().parents[2] / "docker-compose.prod.yml"
    compose = yaml.safe_load(compose_path.read_text())

    services = compose["services"]
    backend = services["backend"]
    ingestion_worker = services["ingestion-worker"]

    assert backend["environment"]["OMNIX_UPLOAD_DIR"] == "/app/uploads"
    assert ingestion_worker["environment"]["OMNIX_UPLOAD_DIR"] == "/app/uploads"
    assert "omnix_uploads:/app/uploads" in backend["volumes"]
    assert "omnix_uploads:/app/uploads" in ingestion_worker["volumes"]
    assert "omnix_uploads" in compose["volumes"]
