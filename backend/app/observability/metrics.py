from typing import Dict, Any
from .schemas import LatencyMetrics, TokenUsage
import time

class MetricsCollector:
    """Collects and aggregates metrics for observability."""
    def __init__(self):
        self.latency_metrics = LatencyMetrics()
        self.token_usage = TokenUsage()
        self._timers: Dict[str, float] = {}

    def start_timer(self, name: str):
        self._timers[name] = time.time()

    def stop_timer(self, name: str) -> float:
        if name in self._timers:
            elapsed_ms = (time.time() - self._timers.pop(name)) * 1000
            
            # Auto-assign if it matches latency metrics fields
            if hasattr(self.latency_metrics, f"{name}_ms"):
                setattr(self.latency_metrics, f"{name}_ms", elapsed_ms)
            
            self._update_total_time()
            return elapsed_ms
        return 0.0

    def add_tokens(self, category: str, count: int):
        if hasattr(self.token_usage, f"{category}_tokens"):
            current = getattr(self.token_usage, f"{category}_tokens")
            setattr(self.token_usage, f"{category}_tokens", current + count)
        
        self.token_usage.total_tokens = (
            self.token_usage.prompt_tokens + 
            self.token_usage.completion_tokens
        )
        
    def set_compression_ratio(self, ratio: float):
        self.token_usage.compression_ratio = ratio

    def _update_total_time(self):
        self.latency_metrics.total_ms = sum([
            self.latency_metrics.retrieval_ms,
            self.latency_metrics.ranking_ms,
            self.latency_metrics.compression_ms,
            self.latency_metrics.prompt_assembly_ms,
            self.latency_metrics.provider_ms
        ])

    def get_snapshot(self) -> Dict[str, Any]:
        return {
            "latencies": self.latency_metrics.model_dump(),
            "tokens": self.token_usage.model_dump()
        }
