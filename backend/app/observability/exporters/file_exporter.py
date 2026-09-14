import json
import aiofiles
import os
import logging
from ..schemas import ObservabilityEvent
from ..serializers import EventSerializer

logger = logging.getLogger(__name__)

class FileExporter:
    """Appends sanitized trace events to a local file asynchronously."""
    
    def __init__(self, file_path: str = "logs/observability.jsonl"):
        self.file_path = file_path
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)

    async def export(self, event: ObservabilityEvent):
        try:
            sanitized = EventSerializer.serialize(event)
            json_str = json.dumps(sanitized)
            
            async with aiofiles.open(self.file_path, mode='a') as f:
                await f.write(json_str + "\n")
        except Exception as e:
            logger.error(f"Failed to write to observability log file: {e}")
