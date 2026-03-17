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
        
    @classmethod
    def get(cls) -> RuntimeManager:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    def register_worker(self, worker_id: str, capabilities: List[str]):
        self.active_workers[worker_id] = {
            "registered_at": datetime.now(timezone.utc).isoformat(),
            "capabilities": capabilities,
            "status": "idle"
        }
        logger.info(f"Worker {worker_id} registered with capabilities: {capabilities}")
        
    def update_worker_status(self, worker_id: str, status: str):
        if worker_id in self.active_workers:
            self.active_workers[worker_id]["status"] = status
            
    def register_provider(self, provider_name: str):
        if provider_name not in self.active_providers:
            self.active_providers.append(provider_name)
            logger.info(f"AI Provider {provider_name} registered")
            
    def set_status(self, status: str):
        self.status = status
        logger.info(f"Runtime status changed to: {status}")
        
    def get_runtime_info(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "uptime_seconds": (datetime.now(timezone.utc) - self.start_time).total_seconds(),
            "active_workers_count": len(self.active_workers),
            "active_providers": self.active_providers,
            "streaming_sessions_count": len(self.streaming_sessions),
            "start_time": self.start_time.isoformat()
        }
