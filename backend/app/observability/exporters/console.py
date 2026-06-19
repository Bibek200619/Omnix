import logging
from ..schemas import ObservabilityEvent
from ..serializers import EventSerializer

logger = logging.getLogger("omnix.observability.console")

class ConsoleExporter:
    """Exports sanitized observability events to the console log."""
    
    def __init__(self, level=logging.INFO):
        self.level = level

    async def export(self, event: ObservabilityEvent):
        sanitized = EventSerializer.serialize(event)
        logger.log(self.level, f"[TRACE {event.trace_context.trace_id}] {event.event_type}: {sanitized.get('payload', {})}")
