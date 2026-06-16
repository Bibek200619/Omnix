import logging
from ..schemas import ObservabilityEvent
from ..serializers import EventSerializer

logger = logging.getLogger(__name__)

class OpenTelemetryExporter:
    """Exports sanitized observability events as OpenTelemetry span attributes when OTel is installed."""
    
    def __init__(self, tracer=None):
        self.tracer = tracer
        if self.tracer is None:
            try:
                from opentelemetry import trace

                self.tracer = trace.get_tracer("omnix.observability")
            except Exception:
                self.tracer = None
        self.is_configured = self.tracer is not None

    async def export(self, event: ObservabilityEvent) -> bool:
        if not self.is_configured:
            logger.debug("OpenTelemetry exporter disabled; event_type=%s", event.event_type)
            return False

        sanitized = EventSerializer.serialize(event)
        with self.tracer.start_as_current_span(event.event_type) as span:
            span.set_attribute("omnix.event_id", sanitized.get("event_id", ""))
            span.set_attribute("omnix.event_type", sanitized.get("event_type", ""))
            trace_context = sanitized.get("trace_context") or {}
            if isinstance(trace_context, dict):
                for key in ("trace_id", "request_id", "workspace_id", "conversation_id", "session_id"):
                    value = trace_context.get(key)
                    if value is not None:
                        span.set_attribute(f"omnix.{key}", str(value))
            payload = sanitized.get("payload") or {}
            if isinstance(payload, dict):
                for key, value in payload.items():
                    if isinstance(value, (str, int, float, bool)) or value is None:
                        span.set_attribute(f"omnix.payload.{key}", "" if value is None else value)
        return True
