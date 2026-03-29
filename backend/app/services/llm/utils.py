import logging
from typing import Any, List, Dict

def get_logger(name: str) -> logging.Logger:
    '''
    Creates and configures a professional-grade logger for the LLM service.
    '''
    logger = logging.getLogger(name)
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        ch = logging.StreamHandler()
        ch.setFormatter(formatter)
        logger.addHandler(ch)
    return logger

def sanitize_messages_for_logging(messages: List[Any]) -> List[Dict[str, Any]]:
    '''
    Sanitize chat messages to prevent logging sensitive user data.
    In a real production app, this might hash or redact PII.
    '''
    return [{"role": getattr(msg, "role", "unknown"), "content_length": len(getattr(msg, "content", ""))} for msg in messages]
