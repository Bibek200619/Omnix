from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import httpx
from supabase import Client, ClientOptions, create_client
from supabase.client import AsyncClient, create_async_client

from ..core.config import get_settings

logger = logging.getLogger(__name__)

# Shared HTTPX limits for high-concurrency production workloads
# max_connections=200 allows for significant concurrent requests per worker
# max_keepalive_connections=50 keeps enough hot connections for low latency
HTTPX_LIMITS = httpx.Limits(
    max_connections=200,
    max_keepalive_connections=50,
    keepalive_expiry=30.0,
)

# Shared timeout configuration
DEFAULT_TIMEOUT = httpx.Timeout(
    connect=10.0,
    read=30.0,
    write=30.0,
    pool=30.0,  # Increased pool timeout further to handle transient saturation
)

@lru_cache
def _get_sync_http_client() -> httpx.Client:
    """Shared sync HTTP client to ensure connection pooling across requests."""
    return httpx.Client(
        timeout=DEFAULT_TIMEOUT,
        limits=HTTPX_LIMITS,
        http2=False,
    )

@lru_cache
def _get_async_http_client() -> httpx.AsyncClient:
    """Shared async HTTP client to ensure connection pooling across requests."""
    return httpx.AsyncClient(
        timeout=DEFAULT_TIMEOUT,
        limits=HTTPX_LIMITS,
        http2=False,
    )

def _client_options(is_async: bool = False) -> ClientOptions:
    return ClientOptions(
        postgrest_client_timeout=DEFAULT_TIMEOUT,
        storage_client_timeout=30,
        function_client_timeout=10,
        httpx_client=_get_async_http_client() if is_async else _get_sync_http_client(),
    )

@lru_cache
def get_supabase() -> Client:
    """Returns a singleton sync Supabase client with optimized pooling."""
    settings = get_settings()
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not key:
        raise ValueError(
            "SUPABASE_SERVICE_ROLE_KEY must be set for trusted backend database operations."
        )

    return create_client(
        settings.supabase_base_url,
        key,
        options=_client_options(is_async=False),
    )

@lru_cache
def get_async_supabase() -> AsyncClient:
    """Returns a singleton async Supabase client for non-blocking database operations."""
    settings = get_settings()
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not key:
        raise ValueError(
            "SUPABASE_SERVICE_ROLE_KEY must be set for trusted backend database operations."
        )

    return create_async_client(
        settings.supabase_base_url,
        key,
        options=_client_options(is_async=True),
    )

@lru_cache
def get_supabase_auth_client() -> Client:
    """Returns a sync Supabase client for auth-related operations."""
    settings = get_settings()
    return create_client(
        settings.supabase_base_url,
        settings.SUPABASE_ANON_KEY,
        options=_client_options(is_async=False),
    )
