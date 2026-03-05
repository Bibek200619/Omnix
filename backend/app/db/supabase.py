from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from ..core.config import get_settings


@lru_cache
def get_supabase() -> Client:
    settings = get_settings()
    return create_client(
        settings.supabase_base_url,
        settings.SUPABASE_SERVICE_ROLE_KEY,
    )


@lru_cache
def get_supabase_auth_client() -> Client:
    settings = get_settings()
    # Use the anon-scoped client for token validation so auth checks do not run with service-role context.
    return create_client(
        settings.supabase_base_url,
        settings.SUPABASE_ANON_KEY,
    )
