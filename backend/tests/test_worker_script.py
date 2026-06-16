from __future__ import annotations

from pathlib import Path


def test_start_workers_script_scales_ingestion_worker_service() -> None:
    script = (Path(__file__).resolve().parents[2] / "scripts" / "start_workers.sh").read_text()

    assert "--scale ingestion-worker=$WORKERS" in script
    assert "-d ingestion-worker" in script
    assert "--scale worker=$WORKERS" not in script
