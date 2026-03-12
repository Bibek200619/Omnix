from typing import Dict, Any, Optional
from datetime import datetime

class ProviderTrace:
    """Captures execution metrics and failure states for model providers."""
    
    def __init__(self):
        self.provider_name: Optional[str] = None
        self.model_name: Optional[str] = None
        self.retries: int = 0
        self.is_streaming: bool = False
        self.first_token_latency_ms: Optional[float] = None
        self.total_latency_ms: Optional[float] = None
        self.error: Optional[str] = None
        self.fallback_triggered: bool = False
        
    def set_provider(self, provider: str, model: str, streaming: bool = False):
        self.provider_name = provider
        self.model_name = model
        self.is_streaming = streaming
        
    def record_retry(self):
        self.retries += 1
        
    def record_fallback(self, new_provider: str, new_model: str):
        self.fallback_triggered = True
        self.provider_name = new_provider
        self.model_name = new_model
        
    def record_first_token(self, latency_ms: float):
        self.first_token_latency_ms = latency_ms
        
    def record_completion(self, latency_ms: float):
        self.total_latency_ms = latency_ms
        
    def record_error(self, error_msg: str):
        self.error = error_msg
        
    def get_snapshot(self) -> Dict[str, Any]:
        return {
            "provider": self.provider_name,
            "model": self.model_name,
            "streaming": self.is_streaming,
            "retries": self.retries,
            "fallback_triggered": self.fallback_triggered,
            "first_token_latency_ms": self.first_token_latency_ms,
            "total_latency_ms": self.total_latency_ms,
            "error": self.error
        }
