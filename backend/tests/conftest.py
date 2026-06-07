"""
Root conftest.py — stubs all heavy production dependencies that are not
available in the CI/local test environment (supabase, redis, sentence_transformers, etc.)

This file is loaded by pytest BEFORE any test module is collected, which
means all app module imports will see the stubs instead of trying to load
the real packages.
"""
from __future__ import annotations

import sys
import importlib
from unittest.mock import AsyncMock, MagicMock


def _pkg(name: str) -> MagicMock:
    """Create a MagicMock that passes isinstance checks for module stubs."""
    m = MagicMock()
    m.__name__ = name
    m.__package__ = name
    m.__spec__ = MagicMock()
    m.__spec__.name = name
    return m


# ---------------------------------------------------------------------------
# httpx  (used in supabase_client.py/checks.py and by Starlette TestClient)
# ---------------------------------------------------------------------------
if "httpx" not in sys.modules:
    try:
        importlib.import_module("httpx")
    except ImportError:
        _httpx = _pkg("httpx")
        _httpx.Client = MagicMock
        # AsyncClient must be an AsyncMock so .aclose() is awaitable (used by close_async_supabase)
        _async_client_instance = AsyncMock()
        _httpx.AsyncClient = MagicMock(return_value=_async_client_instance)
        _httpx.Timeout = MagicMock(return_value=MagicMock())
        _httpx.Limits = MagicMock(return_value=MagicMock())
        _httpx.TransportError = Exception
        _httpx.TimeoutException = Exception
        sys.modules["httpx"] = _httpx

# ---------------------------------------------------------------------------
# supabase and its sub-modules
# ---------------------------------------------------------------------------
_supabase = _pkg("supabase")
_supabase.Client = MagicMock
_supabase.ClientOptions = MagicMock
_supabase.create_client = MagicMock(return_value=MagicMock())

_supabase_client_mod = _pkg("supabase.client")
_supabase_client_mod.AsyncClient = MagicMock
_supabase_client_mod.create_async_client = AsyncMock(return_value=MagicMock())

_supabase_lib = _pkg("supabase.lib")
_supabase_lib_opts = _pkg("supabase.lib.client_options")
_supabase_lib_opts.AsyncClientOptions = MagicMock
_supabase_lib_opts.ClientOptions = MagicMock

sys.modules.setdefault("supabase", _supabase)
sys.modules.setdefault("supabase.client", _supabase_client_mod)
sys.modules.setdefault("supabase.lib", _supabase_lib)
sys.modules.setdefault("supabase.lib.client_options", _supabase_lib_opts)

# ---------------------------------------------------------------------------
# redis
# ---------------------------------------------------------------------------
_redis = _pkg("redis")
_redis_asyncio = _pkg("redis.asyncio")
_redis_asyncio.from_url = MagicMock(return_value=AsyncMock())
_redis.asyncio = _redis_asyncio
sys.modules.setdefault("redis", _redis)
sys.modules.setdefault("redis.asyncio", _redis_asyncio)

# Make aioredis alias point to the stub so queue.py conditional import works
import app.jobs.queue as _q_mod  # noqa: E402  (imported after stubs registered)
_q_mod.aioredis = _redis_asyncio

# ---------------------------------------------------------------------------
# sentence_transformers / torch (used by embedding provider)
# ---------------------------------------------------------------------------
_st = _pkg("sentence_transformers")
_st.SentenceTransformer = MagicMock
sys.modules.setdefault("sentence_transformers", _st)

_torch = _pkg("torch")
sys.modules.setdefault("torch", _torch)

# ---------------------------------------------------------------------------
# pgvector
# ---------------------------------------------------------------------------
_pgvector = _pkg("pgvector")
_pgvector_sqlalchemy = _pkg("pgvector.sqlalchemy")
sys.modules.setdefault("pgvector", _pgvector)
sys.modules.setdefault("pgvector.sqlalchemy", _pgvector_sqlalchemy)
