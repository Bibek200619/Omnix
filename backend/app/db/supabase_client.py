from __future__ import annotations

import asyncio
from functools import lru_cache
import inspect

import httpx
from supabase import Client, ClientOptions, create_client
from supabase.client import AsyncClient, create_async_client
from supabase.lib.client_options import AsyncClientOptions

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


def _build_async_http_client(timeout_seconds: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
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


_async_supabase_client: AsyncClient | None = None
_async_http_client: httpx.AsyncClient | None = None
_async_init_lock = asyncio.Lock()


def _client_options(
    timeout_seconds: float,
    *,
    httpx_client: httpx.Client | None = None,
) -> ClientOptions:
    return ClientOptions(
        postgrest_client_timeout=httpx.Timeout(
            connect=10.0,
            read=timeout_seconds,
            write=timeout_seconds,
            pool=10.0,
        ),
        storage_client_timeout=int(timeout_seconds),
        function_client_timeout=10,
        httpx_client=httpx_client or _build_http_client(timeout_seconds),
    )


def _async_client_options(
    timeout_seconds: float,
    *,
    httpx_client: httpx.AsyncClient,
) -> AsyncClientOptions:
    return AsyncClientOptions(
        postgrest_client_timeout=httpx.Timeout(
            connect=10.0,
            read=timeout_seconds,
            write=timeout_seconds,
            pool=10.0,
        ),
        storage_client_timeout=int(timeout_seconds),
        function_client_timeout=10,
        httpx_client=httpx_client,
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


async def get_async_supabase() -> AsyncClient:
    global _async_http_client, _async_supabase_client

    if _async_supabase_client is not None:
        return _async_supabase_client

    async with _async_init_lock:
        if _async_supabase_client is not None:
            return _async_supabase_client

        settings = get_settings()
        key = settings.SUPABASE_SERVICE_ROLE_KEY
        if not key:
            raise ValueError(
                "SUPABASE_SERVICE_ROLE_KEY must be set for trusted backend database operations."
            )

        _async_http_client = _build_async_http_client(30.0)
        client = create_async_client(
            settings.supabase_base_url,
            key,
            options=_async_client_options(30.0, httpx_client=_async_http_client),
        )
        if inspect.isawaitable(client):
            client = await client

        _async_supabase_client = client
        return _async_supabase_client


async def close_async_supabase() -> None:
    global _async_http_client, _async_supabase_client

    async with _async_init_lock:
        _async_supabase_client = None
        if _async_http_client is not None:
            await _async_http_client.aclose()
            _async_http_client = None


@lru_cache
def get_supabase_auth_client() -> Client:
    settings = get_settings()
    return create_client(
        settings.supabase_base_url,
        settings.SUPABASE_ANON_KEY,
        options=_client_options(20.0),
    )
