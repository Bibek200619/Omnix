from typing import Optional
from .tracing import ContextTrace
from .streaming import StreamingRuntime
import uuid

class ExecutionRuntime:
    """Manages the lifecycle of an AI execution, providing access to tracing and streaming."""
    
    def __init__(self, workspace_id: str, request_id: Optional[str] = None):
        self.workspace_id = workspace_id
        self.request_id = request_id or str(uuid.uuid4())
        self.trace = ContextTrace(workspace_id=workspace_id, request_id=self.request_id)
        self.streaming = StreamingRuntime(self.trace)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
             self.trace.provider.record_error(str(exc_val))
        await self.trace.finalize()
