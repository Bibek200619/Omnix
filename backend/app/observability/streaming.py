import asyncio
from typing import AsyncGenerator, Optional, Callable, Any, Dict
from .tracing import ContextTrace

class StreamingRuntime:
    """Foundations for streaming orchestration, handling interruptions and partial responses."""
    
    def __init__(self, trace: ContextTrace):
        self.trace = trace
        self.is_interrupted = False
        self.chunks_emitted = 0
        self.first_chunk_emitted = False
        
    def interrupt(self):
        """Signal the stream to gracefully stop."""
        self.is_interrupted = True
        
    async def stream_generator(
        self, 
        provider_stream: AsyncGenerator[Any, None], 
        chunk_processor: Optional[Callable[[Any], Dict[str, Any]]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Wraps a provider stream, enforcing observability and interruption logic."""
        
        try:
            self.trace.start_timer("provider")
            
            async for chunk in provider_stream:
                if self.is_interrupted:
                    self.trace.provider.record_error("Stream interrupted by runtime")
                    break
                    
                # Track first token latency
                if not self.first_chunk_emitted:
                    self.first_chunk_emitted = True
                    first_token_latency = self.trace.metrics.stop_timer("provider")
                    # Restart timer for full completion tracking if needed
                    self.trace.metrics.start_timer("provider_completion")
                    self.trace.provider.record_first_token(first_token_latency)
                
                self.chunks_emitted += 1
                
                if chunk_processor:
                    processed = chunk_processor(chunk)
                    yield processed
                else:
                    yield chunk
                    
            # Stream completed successfully
            if self.first_chunk_emitted:
                 total_latency = self.trace.metrics.stop_timer("provider_completion")
                 self.trace.provider.record_completion(total_latency)
                 
        except asyncio.CancelledError:
            self.trace.provider.record_error("Stream cancelled")
            raise
        except Exception as e:
            self.trace.provider.record_error(str(e))
            raise
        finally:
            # Ensure timer is stopped if failed before first token
            if not self.first_chunk_emitted:
                self.trace.metrics.stop_timer("provider")
