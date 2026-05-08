from typing import Dict, Any
from .metrics import MetricsCollector

class TokenTrace:
    """Delegates to MetricsCollector but provides a domain-specific interface for tokens."""
    
    def __init__(self, metrics: MetricsCollector):
        self._metrics = metrics
        
    def track_prompt_tokens(self, tokens: int):
        self._metrics.add_tokens("prompt", tokens)
        
    def track_completion_tokens(self, tokens: int):
        self._metrics.add_tokens("completion", tokens)
        
    def track_retrieval_tokens(self, tokens: int):
        self._metrics.add_tokens("retrieval", tokens)
        
    def track_memory_tokens(self, tokens: int):
        self._metrics.add_tokens("memory", tokens)
        
    def reserve_completion_tokens(self, tokens: int):
        self._metrics.token_usage.reserved_completion_tokens = tokens
        
    def set_compression_ratio(self, ratio: float):
        self._metrics.set_compression_ratio(ratio)
