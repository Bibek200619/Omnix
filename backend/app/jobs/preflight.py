from __future__ import annotations

import asyncio
import logging
import sys
from typing import Any

from .queue import get_redis
from ..db.supabase import get_supabase
from ..embeddings.dimensions import get_expected_embedding_dimension
from ..embeddings.local_provider import LocalEmbeddingProvider
from ..rag.startup import initialize_vector_store, shutdown_vector_store
from ..services.supabase_service import select_all_trusted

logger = logging.getLogger(__name__)


def _vector_dimension_from_db_value(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, list):
        return len(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            inner = stripped[1:-1].strip()
            if not inner:
                return 0
            return inner.count(",") + 1
    return None


async def run_preflight() -> int:
    """Performs a preflight check for worker prerequisites.

    Checks:
    - Redis connectivity
    - Vector store initializes
    - Local embedding model can load
    - Embedding dimension matches DB/vector contract
    - Sample document embedding dimension matches the expected dimension

    Returns 0 on success, non-zero on failure.
    """
    ok = True
    expected_dim = get_expected_embedding_dimension()

    # Redis connectivity
    try:
        redis = get_redis()
        pong = await redis.ping()
        logger.info("Preflight: Redis ping response=%s", pong)
    except Exception as exc:
        logger.exception("Preflight ERROR: failed to connect to Redis: %s", exc)
        ok = False

    # Vector store initialization
    try:
        store = await initialize_vector_store()
        logger.info("Preflight: vector store initialized: %s", store.__class__.__name__)
    except Exception as exc:
        logger.exception("Preflight ERROR: vector store failed to initialize: %s", exc)
        ok = False

    # Model load
    try:
        provider = LocalEmbeddingProvider()
        await provider._ensure_loaded()
        logger.info(
            "Preflight: local embedding model loaded: %s (dim=%s, expected=%s)",
            provider.model_name,
            provider.embedding_dim,
            expected_dim,
        )
        if provider.embedding_dim != expected_dim:
            logger.error(
                "Preflight ERROR: local model dimension %s does not match expected dimension %s.",
                provider.embedding_dim,
                expected_dim,
            )
            ok = False
    except Exception as exc:
        logger.exception("Preflight ERROR: failed to load local embedding model: %s", exc)
        ok = False

    # DB contract helper from local-embeddings migration
    try:
        response = await asyncio.to_thread(lambda: get_supabase().rpc("omnix_embedding_contract", {}).execute())
        rows = getattr(response, "data", None) or []
        if rows:
            contract = rows[0]
            logger.info("Preflight: DB embedding contract: %s", contract)
            embedding_type = str(contract.get("embedding_type") or "")
            if f"vector({expected_dim})" not in embedding_type:
                logger.error(
                    "Preflight ERROR: documents.embedding is %s, expected vector(%d). Apply the local embeddings migration.",
                    embedding_type or "unknown",
                    expected_dim,
                )
                ok = False
            if contract.get("legacy_column_exists"):
                logger.warning(
                    "Preflight WARNING: embedding_legacy exists. Run incremental re-embedding before dropping legacy vectors."
                )
            if contract.get("workspace_column_exists") is False:
                logger.error(
                    "Preflight ERROR: documents.workspace_id is missing. Apply the workspace/collaboration migrations before running ingestion jobs."
                )
                ok = False
        else:
            logger.warning("Preflight WARNING: omnix_embedding_contract returned no rows.")
            ok = False
    except Exception as exc:
        logger.error(
            "Preflight ERROR: DB contract RPC unavailable. Apply migration 0012_local_embeddings_contract.sql. Error: %s",
            exc,
        )
        ok = False

    # Sample DB embedding dimension check
    try:
        rows = await select_all_trusted("documents", "id,embedding", limit=10)
        checked = 0
        if rows:
            for row in rows:
                emb = row.get("embedding")
                db_dim = _vector_dimension_from_db_value(emb)
                if db_dim is None:
                    continue
                checked += 1
                logger.info("Preflight: sample document %s embedding dim=%s", row.get("id"), db_dim)
                if db_dim != expected_dim:
                    logger.error(
                        "Preflight ERROR: sample document %s has embedding dim %s, expected %s.",
                        row.get("id"),
                        db_dim,
                        expected_dim,
                    )
                    ok = False
            if checked == 0:
                logger.info("Preflight: no non-null sample embeddings found; fresh installs or pending re-embedding are OK.")
            else:
                logger.info("Preflight: checked %d sample embedding(s).", checked)
        else:
            logger.info("Preflight: no documents found in DB (safe for fresh installs)")
    except Exception as exc:
        logger.exception("Preflight WARNING: failed to query sample document: %s", exc)

    try:
        await shutdown_vector_store()
    except Exception:
        logger.exception("Preflight WARNING: vector store shutdown hook failed.")

    return 0 if ok else 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    code = asyncio.run(run_preflight())
    sys.exit(code)
