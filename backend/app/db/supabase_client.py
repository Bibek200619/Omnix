from __future__ import annotations

from functools import lru_cache

import httpx
from supabase import Client, ClientOptions, create_client

from ..core.config import get_settings


def _build_http_client(timeout_seconds: float) -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(
            connect=10.0,
            read=timeout_seconds,
            write=timeout_seconds,
            pool=10.0,
        ),
        limits=httpx.Limits(
            max_connections=20,
            max_keepalive_connections=5,
            keepalive_expiry=15.0,
        ),
        http2=False,
    )


def _client_options(timeout_seconds: float) -> ClientOptions:
    return ClientOptions(
        postgrest_client_timeout=httpx.Timeout(
            connect=10.0,
            read=timeout_seconds,
            write=timeout_seconds,
            pool=10.0,
        ),
        storage_client_timeout=int(timeout_seconds),
        function_client_timeout=10,
        httpx_client=_build_http_client(timeout_seconds),
    )


@lru_cache
def get_supabase() -> Client:
    settings = get_settings()
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not key:
        raise ValueError(
            "SUPABASE_SERVICE_ROLE_KEY must be set for trusted backend database operations."
        )

    return create_client(
        settings.supabase_base_url,
        key,
        options=_client_options(30.0),
    )


@lru_cache
def get_supabase_auth_client() -> Client:
    settings = get_settings()
    return create_client(
        settings.supabase_base_url,
        settings.SUPABASE_ANON_KEY,
        options=_client_options(20.0),
    )
