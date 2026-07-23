from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.jobs import queue, worker


REPO_ROOT = Path(__file__).resolve().parents[3]
DEV_COMPOSE = REPO_ROOT / "docker-compose.yml"
PROD_COMPOSE = REPO_ROOT / "docker-compose.prod.yml"
DOCKERFILE = REPO_ROOT / "backend" / "Dockerfile.backend"
WORKER_SCRIPT = REPO_ROOT / "scripts" / "start_workers.sh"
OCR_SYSTEMD_UNIT = REPO_ROOT / "scripts" / "omnix-ocr-worker.service"
UPLOAD_ROUTER = REPO_ROOT / "backend" / "app" / "routers" / "upload.py"
GOOGLE_DRIVE_ROUTER = REPO_ROOT / "backend" / "app" / "routers" / "google_drive.py"


class _FakeRedis:
    def __init__(self) -> None:
        self.items: dict[str, list[str]] = {}
        self.pushes: list[tuple[str, str]] = []

    async def lrange(self, queue_name: str, start: int, end: int) -> list[str]:
        return list(self.items.get(queue_name, []))

    async def lpush(self, queue_name: str, job_id: str) -> int:
        self.pushes.append((queue_name, job_id))
        self.items.setdefault(queue_name, []).insert(0, job_id)
        return len(self.items[queue_name])


def _environment(service: dict[str, Any]) -> dict[str, str]:
    raw = service.get("environment") or {}
    if isinstance(raw, dict):
        return {str(key): str(value) for key, value in raw.items()}
    result: dict[str, str] = {}
    for item in raw:
        key, _, value = str(item).partition("=")
        result[key] = value
    return result


def test_pdf_jobs_are_routed_to_a_dedicated_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_INGESTION_QUEUE", "queue:ingestion")
    monkeypatch.setenv("OMNIX_OCR_JOB_QUEUE", "queue:ocr")

    assert queue.ingestion_queue_for_file("scan.pdf", "application/pdf") == "queue:ocr"
    assert queue.ingestion_queue_for_file("report.bin", "application/pdf") == "queue:ocr"
    assert queue.ingestion_queue_for_file("notes.md", "text/markdown") == "queue:ingestion"


@pytest.mark.asyncio
async def test_enqueue_persists_the_selected_queue_for_recovery(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = _FakeRedis()
    records: list[dict[str, Any]] = []

    async def fake_insert_one(table: str, record: dict[str, Any]) -> dict[str, Any]:
        assert table == "jobs"
        records.append(record)
        return record

    import app.services.supabase_service as supabase_service

    monkeypatch.setattr(supabase_service, "insert_one_trusted", fake_insert_one)
    monkeypatch.setattr(queue, "get_redis", lambda: fake_redis)

    job_id = await queue.enqueue_job({"type": "ingest_file", "_queue": "queue:ocr"})

    assert records[0]["payload"]["_queue"] == "queue:ocr"
    assert fake_redis.pushes == [("queue:ocr", job_id)]


@pytest.mark.asyncio
async def test_queue_recovery_requeues_only_jobs_for_its_own_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = _FakeRedis()
    created_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    async def fake_select_all(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return [
            {"id": "normal-job", "payload": {"_queue": "queue:ingestion"}, "created_at": created_at},
            {"id": "ocr-job", "payload": {"_queue": "queue:ocr"}, "created_at": created_at},
        ]

    import app.services.supabase_service as supabase_service

    monkeypatch.setattr(supabase_service, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(queue, "get_redis", lambda: fake_redis)

    result = await queue.recover_missing_queued_jobs(queue="queue:ingestion", min_age_seconds=0)

    assert result["requeued_jobs"] == 1
    assert result["other_queue_jobs"] == 1
    assert fake_redis.pushes == [("queue:ingestion", "normal-job")]


@pytest.mark.asyncio
async def test_ocr_retry_preserves_the_persisted_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    pushed: list[tuple[str, str | None]] = []

    async def fake_update(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {}

    async def fake_push(job_id: str, *, queue_name: str | None = None) -> None:
        pushed.append((job_id, queue_name))

    monkeypatch.setattr(worker, "update_one_trusted", fake_update)
    monkeypatch.setattr(worker, "_push_retry_job", fake_push)

    status = await worker._retry_or_dead_letter_job(
        "ocr-job",
        {"payload": {"_queue": "queue:ocr"}},
        attempt_number=1,
        result={"status": "failed", "error": "OCR timed out"},
        error="OCR timed out",
    )

    assert status == "queued"
    assert pushed == [("ocr-job", "queue:ocr")]


def test_ocr_worker_role_uses_bounded_runtime_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMNIX_ROLE", "ocr_worker")
    monkeypatch.setenv("OMNIX_WORKER_ID", "ocr-worker-test")

    assert queue.worker_queue_name() == "omnix:ocr"
    assert worker._worker_id() == "ocr-worker-test"
    assert worker._worker_concurrency() == 1
    assert worker._job_timeout_seconds() == 30 * 60


def test_ocr_worker_topology_is_complete_in_compose_and_service_files() -> None:
    dev_services = yaml.safe_load(DEV_COMPOSE.read_text(encoding="utf-8"))["services"]
    prod_services = yaml.safe_load(PROD_COMPOSE.read_text(encoding="utf-8"))["services"]

    for services in (dev_services, prod_services):
        assert "ocr-worker" in services
        worker_service = services["ocr-worker"]
        assert worker_service["command"] == ["python", "-m", "app.jobs.worker"]
        assert _environment(worker_service)["OMNIX_ROLE"] == "ocr_worker"
        assert _environment(worker_service)["OMNIX_WORKER_ID"] == "ocr_worker_main"

    assert "omnix_uploads:/app/uploads" in prod_services["ocr-worker"]["volumes"]
    assert "tesseract-ocr" in DOCKERFILE.read_text(encoding="utf-8")
    assert "--scale ocr-worker=1" in WORKER_SCRIPT.read_text(encoding="utf-8")
    unit = OCR_SYSTEMD_UNIT.read_text(encoding="utf-8")
    assert "Environment=OMNIX_ROLE=ocr_worker" in unit
    assert "Environment=OMNIX_WORKER_ID=ocr_worker_main" in unit


def test_file_ingestion_entrypoints_select_a_queue_from_file_metadata() -> None:
    assert "ingestion_queue_for_file(filename, file_type)" in UPLOAD_ROUTER.read_text(encoding="utf-8")
    assert "ingestion_queue_for_file(filename, file_meta.get(\"mimeType\"))" in GOOGLE_DRIVE_ROUTER.read_text(encoding="utf-8")
