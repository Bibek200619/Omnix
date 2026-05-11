from typing import Dict, Any
from .tracing import ContextTrace
from .serializers import EventSerializer

class DiagnosticsUtils:
    """Utility class for diagnosing traces without leaking secrets."""
    
    @staticmethod
    def extract_safe_diagnostics(trace: ContextTrace) -> Dict[str, Any]:
        """Returns a sanitized snapshot of the trace for diagnostic purposes."""
        
        raw_snapshot = {
            "trace_id": trace.context.trace_id,
            "workspace_id": trace.context.workspace_id,
            "request_id": trace.context.request_id,
            "metrics": trace.metrics.get_snapshot(),
            "graph_summary": {
                node_id: node.status 
                for node_id, node in trace.graph.get_snapshot().nodes.items()
            },
            "retrieval_summary": {
                "queries": len(trace.retrieval.queries),
                "results": len(trace.retrieval.results),
                "discarded": len(trace.retrieval.discarded_results)
            },
            "prompt_summary": {
                "context_injected": len(trace.prompt.injected_context),
                "truncations": len(trace.prompt.truncation_events)
            },
            "provider_summary": trace.provider.get_snapshot()
        }
        
        # Ensure complete sanitization
        return EventSerializer.serialize(raw_snapshot)
