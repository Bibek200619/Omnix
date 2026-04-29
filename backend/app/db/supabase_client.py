from __future__ import annotations

import asyncio
from functools import lru_cache
import inspect
import logging

import httpx
from supabase import Client, ClientOptions, create_client
from supabase.client import AsyncClient, create_async_client
from supabase.lib.client_options import AsyncClientOptions

from ..core.config import get_settings

logger = logging.getLogger(__name__)

HTTPX_LIMITS = httpx.Limits(
    max_connections=200,
    max_keepalive_connections=50,
    keepalive_expiry=30.0,
)

DEFAULT_TIMEOUT = httpx.Timeout(
    connect=10.0,
    read=30.0,
    write=30.0,
    pool=30.0,
)


@lru_cache
def _get_sync_http_client() -> httpx.Client:
    return httpx.Client(
        timeout=DEFAULT_TIMEOUT,
        limits=HTTPX_LIMITS,
        http2=False,
    )


def _build_async_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=DEFAULT_TIMEOUT,
        limits=HTTPX_LIMITS,
        http2=False,
    )


_async_supabase_client: AsyncClient | None = None
_async_http_client: httpx.AsyncClient | None = None
_async_init_lock = asyncio.Lock()


def _client_options() -> ClientOptions:
    return ClientOptions(
        postgrest_client_timeout=DEFAULT_TIMEOUT,
        storage_client_timeout=30,
        function_client_timeout=10,
        httpx_client=_get_sync_http_client(),
    )


def _async_client_options(httpx_client: httpx.AsyncClient) -> AsyncClientOptions:
    return AsyncClientOptions(
        postgrest_client_timeout=DEFAULT_TIMEOUT,
        storage_client_timeout=30,
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
        options=_client_options(),
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

        _async_http_client = _build_async_http_client()
        client = create_async_client(
            settings.supabase_base_url,
            key,
            options=_async_client_options(_async_http_client),
        )
        if inspect.isawaitable(client):
            client = await client

        _async_supabase_client = client
        logger.info("Async Supabase client initialized.")
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
        options=_client_options(),
    )
