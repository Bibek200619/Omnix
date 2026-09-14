import re
from typing import Any, Dict

SENSITIVE_KEYS = {
    "api_key", "secret", "password", "token", "auth", 
    "authorization", "bearer", "supabase_key", "openai_api_key",
    "access_token", "refresh_token"
}

def sanitize_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively sanitize a dictionary by redacting sensitive keys."""
    sanitized = {}
    for k, v in data.items():
        if isinstance(v, dict):
            sanitized[k] = sanitize_dict(v)
        elif isinstance(v, list):
            sanitized[k] = [sanitize_dict(i) if isinstance(i, dict) else i for i in v]
        elif _is_sensitive_key(k):
            sanitized[k] = "***REDACTED***"
        elif isinstance(v, str):
            sanitized[k] = sanitize_string(v)
        else:
            sanitized[k] = v
    return sanitized

def _is_sensitive_key(key: str) -> bool:
    key_lower = key.lower()
    return any(sensitive in key_lower for sensitive in SENSITIVE_KEYS)

def sanitize_string(value: str) -> str:
    """Sanitize strings that might contain tokens (e.g. Bearer xxxx)."""
    # Redact Bearer tokens
    value = re.sub(r'(Bearer\s+)[A-Za-z0-9\-\._~+/]+=*', r'\1***REDACTED***', value, flags=re.IGNORECASE)
    # Redact common key formats loosely
    value = re.sub(r'(api[_\-]?key\s*[:=]\s*)[\'"]?[A-Za-z0-9\-\._]+[\'"]?', r'\1"***REDACTED***"', value, flags=re.IGNORECASE)
    return value

class EventSerializer:
    @staticmethod
    def serialize(event: Any) -> Dict[str, Any]:
        if hasattr(event, "model_dump"):
            data = event.model_dump()
        elif hasattr(event, "dict"):
            data = event.dict()
        elif isinstance(event, dict):
            data = event
        else:
            data = {"value": str(event)}
        
        return sanitize_dict(data)
