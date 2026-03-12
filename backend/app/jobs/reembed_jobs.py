from __future__ import annotations

import logging
from typing import Any, List

from .queue import enqueue_job
from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embedding_dimension
from ..services.supabase_service import select_one_trusted, update_one_trusted, select_all_trusted
from ..rag.startup import get_vector_store
from ..rag.embedding import get_embeddings_async

logger = logging.getLogger(__name__)


async def handle_reembed_batch(job_row: dict[str, Any]) -> dict[str, Any]:
    payload = job_row.get("payload") or {}
    if isinstance(payload, str):
        try:
            import json

            payload = json.loads(payload)
        except Exception:
            logger.exception("Invalid reembed_batch payload JSON")
            return {"status": "failed", "error": "invalid payload"}

    document_ids: List[str] = payload.get("document_ids") or []
    if isinstance(document_ids, str):
        try:
            import json

            document_ids = json.loads(document_ids)
        except Exception:
            document_ids = [document_ids]

    if not document_ids:
        logger.warning("reembed_batch called with empty document_ids")
        return {"status": "completed", "processed": 0}

    processed = 0
    skipped = 0
    expected_dim = get_expected_embedding_dimension()
    try:
        vector_store = get_vector_store()
    except Exception as exc:
        logger.exception("Vector store unavailable for reembed job: %s", exc)
        return {"status": "failed", "error": "vector store unavailable"}

    for doc_id in document_ids:
        try:
            doc = await select_one_trusted("documents", "id,content,user_id,workspace_id", {"id": doc_id})
            if not doc:
                logger.warning("Document %s not found for re-embedding", doc_id)
                continue
            text = doc.get("content") or ""
            if not text.strip():
                logger.debug("Document %s empty content, skipping embedding", doc_id)
                continue

            embeddings = await get_embeddings_async([text])
            if not embeddings:
                logger.warning("No embedding produced for document %s", doc_id)
                continue
            emb = embeddings[0]
            validate_embedding_dimension(emb, expected_dim=expected_dim, label=f"document {doc_id} embedding")

            # Update document in DB
            await update_one_trusted("documents", {"id": doc_id}, {"embedding": emb})

            # Mirror into vector store
            try:
                user_id = doc.get("user_id")
                workspace_id = doc.get("workspace_id")
                vector_store.add_embeddings([emb], [doc_id], [user_id], [workspace_id])
            except Exception:
                logger.exception("Failed to mirror embedding for doc %s into vector store", doc_id)

            processed += 1
        except Exception:
            logger.exception("Failed to re-embed document %s", doc_id)
            skipped += 1

    logger.info("Re-embedded %d documents in batch; skipped=%d", processed, skipped)
    return {"status": "completed", "processed": processed, "skipped": skipped, "expected_dimension": expected_dim}


async def enqueue_reembed_all(batch_size: int = 50) -> dict[str, Any]:
    """Enqueue re-embedding jobs for all documents in the system in batches.

    This function reads document ids in pages and enqueues 'reembed_batch' jobs.
    It returns a summary with number of jobs created.
    """
    created = 0
    # Read all document ids in a trusted way
    offset = 0
    while True:
        rows = await select_all_trusted(
            "documents",
            "id",
            order_by="created_at",
            limit=batch_size,
            offset=offset,
        )
        if not rows:
            break
        ids = [r["id"] for r in rows if r.get("id")]
        if not ids:
            break
        # enqueue job
        payload = {"type": "reembed_batch", "document_ids": ids, "expected_dimension": get_expected_embedding_dimension()}
        await enqueue_job(payload)
        created += 1
        offset += batch_size
        # stop if fewer than batch_size returned
        if len(rows) < batch_size:
            break
    logger.info("Queued %d re-embedding batch job(s).", created)
    return {"jobs_created": created, "batch_size": batch_size}


if __name__ == "__main__":
    import asyncio
    import os

    logging.basicConfig(level=logging.INFO)
    size = int(os.environ.get("REEMBED_BATCH_SIZE", "50"))
    summary = asyncio.run(enqueue_reembed_all(batch_size=size))
    print(summary)
