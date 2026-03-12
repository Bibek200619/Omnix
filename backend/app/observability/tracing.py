from typing import Dict, Any, Optional
import time

from .schemas import TraceContext, ObservabilityEvent
from .metrics import MetricsCollector
from .execution_graph import ExecutionGraph
from .retrieval_trace import RetrievalTrace
from .prompt_trace import PromptTrace
from .token_trace import TokenTrace
from .provider_trace import ProviderTrace
from .event_bus import event_bus

class ContextTrace:
    """Unified trace for a single AI execution lifecycle."""
    
    def __init__(self, trace_id: Optional[str] = None, workspace_id: Optional[str] = None, request_id: Optional[str] = None):
        kwargs = {}
        if trace_id: kwargs["trace_id"] = trace_id
        if workspace_id: kwargs["workspace_id"] = workspace_id
        if request_id: kwargs["request_id"] = request_id
        
        self.context = TraceContext(**kwargs)
        self.metrics = MetricsCollector()
        self.graph = ExecutionGraph()
        self.retrieval = RetrievalTrace()
        self.prompt = PromptTrace()
        self.tokens = TokenTrace(self.metrics)
        self.provider = ProviderTrace()
        
        self.start_time = time.time()
        self.is_finalized = False
        
    async def log_event(self, event_type: str, payload: Dict[str, Any]):
        event = ObservabilityEvent(
            event_type=event_type,
            trace_context=self.context,
            payload=payload
        )
        await event_bus.publish(event)
        
    async def finalize(self):
        if self.is_finalized:
            return
            
        self.is_finalized = True
        total_time_ms = (time.time() - self.start_time) * 1000
        
        snapshot = {
            "metrics": self.metrics.get_snapshot(),
            "graph": self.graph.get_snapshot().model_dump(),
            "retrieval": self.retrieval.get_snapshot(),
            "prompt": self.prompt.get_snapshot(),
            "provider": self.provider.get_snapshot(),
            "total_execution_ms": total_time_ms
        }
        
        await self.log_event("execution_finalized", snapshot)

    # Helper methods for metric timers
    def start_timer(self, name: str):
        self.metrics.start_timer(name)
        
    def stop_timer(self, name: str) -> float:
        return self.metrics.stop_timer(name)
