from __future__ import annotations

import asyncio
import logging
import os
import sys

from .queue import get_redis
from ..embeddings.local_provider import LocalEmbeddingProvider
from ..services.supabase_service import select_all_trusted

logger = logging.getLogger(__name__)


async def run_preflight() -> int:
    """Performs a preflight check for worker prerequisites.

    Checks:
    - Local embedding model can load
    - Redis connectivity
    - Sample document embedding dimension matches EMBEDDING_DIM (if set)

    Returns 0 on success, non-zero on failure.
    """
    ok = True

    # Model load
    try:
        provider = LocalEmbeddingProvider()
        await provider._ensure_loaded()
        logger.info("Preflight: local embedding model loaded: %s (dim=%s)", provider.model_name, provider.embedding_dim)
    except Exception as exc:
        logger.exception("Preflight ERROR: failed to load local embedding model: %s", exc)
        ok = False

    # Redis connectivity
    try:
        redis = get_redis()
        pong = await redis.ping()
        logger.info("Preflight: Redis ping response=%s", pong)
    except Exception as exc:
        logger.exception("Preflight ERROR: failed to connect to Redis: %s", exc)
        ok = False

    # Sample DB embedding dimension check
    try:
        rows = await select_all_trusted("documents", "id,embedding", limit=1)
        if rows:
            emb = rows[0].get("embedding")
            if emb and isinstance(emb, list):
                db_dim = len(emb)
                env_dim = os.environ.get("EMBEDDING_DIM")
                if env_dim:
                    try:
                        env_dim = int(env_dim)
                    except Exception:
                        env_dim = None
                logger.info("Preflight: found document embedding dim=%s, EMBEDDING_DIM=%s", db_dim, env_dim)
                if env_dim and env_dim != db_dim:
                    logger.warning("Preflight WARNING: DB embedding dim (%s) != EMBEDDING_DIM (%s). Consider migrating DB embedding vector type.", db_dim, env_dim)
            else:
                logger.info("Preflight: no embedding vector present in sample document; re-embedding may be required.")
        else:
            logger.info("Preflight: no documents found in DB (safe for fresh installs)")
    except Exception as exc:
        logger.exception("Preflight WARNING: failed to query sample document: %s", exc)

    return 0 if ok else 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    code = asyncio.run(run_preflight())
    sys.exit(code)
