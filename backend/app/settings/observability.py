from __future__ import annotations
from .base import BaseAppSettings

class ObservabilitySettings(BaseAppSettings):
    ENABLE_TRACING: bool = True
    ENABLE_METRICS: bool = True
    TRACING_EXPORTER: str = "console" # console, otlp
    OTLP_ENDPOINT: str | None = None
