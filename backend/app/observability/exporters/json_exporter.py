import json
import logging
from ..schemas import ObservabilityEvent
from ..serializers import EventSerializer

logger = logging.getLogger("omnix.observability.json")

class JSONExporter:
    """Exports events as structured JSON."""
    
    async def export(self, event: ObservabilityEvent):
        try:
            sanitized = EventSerializer.serialize(event)
            json_str = json.dumps(sanitized)
            # In a real system, this might go to stdout for a log aggregator
            # or directly to a centralized logging system.
            logger.info(json_str)
        except Exception as e:
            logger.error(f"Failed to export JSON event: {e}")
