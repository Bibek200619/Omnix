from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

class RuntimeManager:
    _instance: RuntimeManager | None = None

    def __init__(self):
        self.start_time = datetime.now(timezone.utc)
        self.active_workers: Dict[str, Any] = {}
        self.active_providers: List[str] = []
        self.streaming_sessions: Dict[str, Any] = {}
        self.status = "initializing"
        self.status_reason: str | None = None
        # Ingestion worker counters (in-process only; reset on restart)
        self._jobs_processing: int = 0
        self._jobs_completed: int = 0
        self._jobs_failed: int = 0

    @classmethod
    def get(cls) -> RuntimeManager:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register_worker(self, worker_id: str, capabilities: List[str], worker_type: str = "generic"):
        self.active_workers[worker_id] = {
            "registered_at": datetime.now(timezone.utc).isoformat(),
            "capabilities": capabilities,
            "worker_type": worker_type,
            "status": "idle",
        }
        logger.info("Worker %s registered (type=%s, capabilities=%s)", worker_id, worker_type, capabilities)

    def update_worker_status(self, worker_id: str, status: str):
        if worker_id in self.active_workers:
            self.active_workers[worker_id]["status"] = status

    def record_job_started(self, worker_id: str):
        self._jobs_processing += 1
        self.update_worker_status(worker_id, "processing")

    def record_job_completed(self, worker_id: str, success: bool):
        self._jobs_processing = max(0, self._jobs_processing - 1)
        if success:
            self._jobs_completed += 1
        else:
            self._jobs_failed += 1
        self.update_worker_status(worker_id, "idle")

    def register_provider(self, provider_name: str):
        if provider_name not in self.active_providers:
            self.active_providers.append(provider_name)
            logger.info("AI Provider %s registered", provider_name)

    def set_status(self, status: str, reason: str | None = None):
        self.status = status
        self.status_reason = reason
        logger.info("Runtime status changed to: %s", status)

    def get_ingestion_worker_metrics(self) -> Dict[str, Any]:
        """Return in-process job counters. Queue depth is resolved separately from Redis."""
        ingestion_workers = {
            wid: info for wid, info in self.active_workers.items()
            if info.get("worker_type") == "ingestion"
        }
        return {
            "active_workers": len(ingestion_workers),
            "worker_details": ingestion_workers,
            "processing_jobs": self._jobs_processing,
            "completed_jobs": self._jobs_completed,
            "failed_jobs": self._jobs_failed,
        }

    def get_runtime_info(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "status_reason": self.status_reason,
            "uptime_seconds": (datetime.now(timezone.utc) - self.start_time).total_seconds(),
            "active_workers_count": len(self.active_workers),
            "active_providers": self.active_providers,
            "streaming_sessions_count": len(self.streaming_sessions),
            "start_time": self.start_time.isoformat(),
        }
