from __future__ import annotations

import logging
import time
from typing import Any

from starlette.concurrency import run_in_threadpool

from ..core.config import get_settings
from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embedding_dimension
from ..rag.embedding import get_embedding
from ..rag.vector_store_base import VectorStore
from ..services.supabase_service import select_all, select_all_trusted
from .scoring import RetrievalResult, distance_to_similarity

logger = logging.getLogger(__name__)

DOCUMENT_COLUMNS = "id,content,file_id,created_at,workspace_id,user_id,chunk_index"
FILE_COLUMNS = "id,file_name,metadata,workspace_id,user_id"


def _workspace_scope_filter(workspace_id: str | list[str] | None) -> str | list[str] | None:
    if workspace_id is None:
        return None
    if isinstance(workspace_id, list):
        scoped_ids = [str(item) for item in workspace_id if str(item or "").strip()]
        if not scoped_ids:
            return None
        return scoped_ids[0] if len(scoped_ids) == 1 else scoped_ids
    value = str(workspace_id).strip()
    return value or None


class SemanticSearch:
    """Provider-independent semantic search over the configured VectorStore."""

    def __init__(self, vector_store: VectorStore) -> None:
        if not isinstance(vector_store, VectorStore):
            raise TypeError("vector_store must implement VectorStore.")
        self.vector_store = vector_store

    async def search(
        self,
        query: str,
        *,
        user_id: str,
        workspace_id: str | list[str] | None = None,
        top_k: int = 3,
        distance_threshold: float | None = None,
    ) -> list[RetrievalResult]:
        started_at = time.perf_counter()
        if not query or not query.strip():
            return []
        if not user_id:
            raise ValueError("user_id is required for semantic retrieval.")

        if distance_threshold is None:
            distance_threshold = get_settings().SIMILARITY_THRESHOLD

        try:
            query_embedding = await get_embedding(query)
            validate_embedding_dimension(
                query_embedding,
                expected_dim=get_expected_embedding_dimension(),
                label="semantic query embedding",
            )
        except Exception:
            logger.exception("Semantic query embedding failed.")
            return []

        try:
            raw_matches = await run_in_threadpool(
                self.vector_store.search,
                query_embedding,
                user_id,
                workspace_id,
                top_k,
            )
        except Exception:
            logger.exception("Vector store semantic search failed.")
            return []

        filtered_matches: list[tuple[str, float]] = []
        rejected = 0
        for chunk_id, distance in raw_matches:
            if distance_threshold is not None and float(distance) > float(distance_threshold):
                rejected += 1
                continue
            filtered_matches.append((str(chunk_id), float(distance)))

        if not filtered_matches:
            logger.info(
                "Semantic search returned no matches after thresholding (raw=%d, rejected=%d, threshold=%s).",
                len(raw_matches),
                rejected,
                distance_threshold,
            )
            return []

        chunk_ids = [chunk_id for chunk_id, _ in filtered_matches]
        chunk_rows = await self._fetch_chunks(chunk_ids, user_id=user_id, workspace_id=workspace_id)
        if not chunk_rows:
            return []

        file_ids = sorted({str(row["file_id"]) for row in chunk_rows if row.get("file_id")})
        files_map = await self._fetch_files(file_ids, user_id=user_id, workspace_id=workspace_id)

        distance_by_id = {chunk_id: distance for chunk_id, distance in filtered_matches}
        chunk_by_id = {str(row.get("id")): row for row in chunk_rows}
        results: list[RetrievalResult] = []

        for chunk_id in chunk_ids:
            row = chunk_by_id.get(chunk_id)
            if not row:
                logger.warning("Semantic match %s was not visible in the authorized DB scope.", chunk_id)
                continue
            content = (row.get("content") or "").strip()
            if not content:
                continue

            distance = distance_by_id.get(chunk_id)
            file_id = str(row.get("file_id")) if row.get("file_id") else None
            file_row = files_map.get(file_id or "", {})
            similarity = distance_to_similarity(distance)
            result = RetrievalResult(
                chunk_id=chunk_id,
                content=content,
                file_id=file_id,
                file_name=file_row.get("file_name") or "Unknown File",
                workspace_id=str(row.get("workspace_id")) if row.get("workspace_id") else None,
                user_id=str(row.get("user_id")) if row.get("user_id") else None,
                created_at=str(row.get("created_at")) if row.get("created_at") else None,
                metadata=file_row.get("metadata") or {},
                chunk_index=int(row["chunk_index"]) if row.get("chunk_index") is not None else None,
                semantic_score=similarity,
                distance=distance,
                sources={"semantic"},
                diagnostics={"vector_distance": distance, "vector_similarity": similarity},
            )
            results.append(result)

        self._assign_chunk_indexes(results)
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "Semantic search completed: raw=%d, accepted=%d, rejected=%d, latency_ms=%.2f.",
            len(raw_matches),
            len(results),
            rejected,
            elapsed_ms,
        )
        return results

    async def _fetch_chunks(
        self,
        chunk_ids: list[str],
        *,
        user_id: str,
        workspace_id: str | list[str] | None,
    ) -> list[dict[str, Any]]:
        if not chunk_ids:
            return []

        workspace_scope = _workspace_scope_filter(workspace_id)
        if workspace_scope:
            rows = await select_all_trusted(
                "documents",
                DOCUMENT_COLUMNS,
                filters={"id": chunk_ids, "workspace_id": workspace_scope},
            )
            
            w_ids = set(workspace_scope) if isinstance(workspace_scope, list) else {workspace_scope}
            return [row for row in rows if str(row.get("workspace_id") or "") in w_ids]

        rows = await select_all(
            "documents",
            DOCUMENT_COLUMNS,
            filters={"id": chunk_ids, "user_id": user_id},
        )
        return [row for row in rows if not row.get("workspace_id")]

    async def _fetch_files(
        self,
        file_ids: list[str],
        *,
        user_id: str,
        workspace_id: str | list[str] | None,
    ) -> dict[str, dict[str, Any]]:
        if not file_ids:
            return {}

        workspace_scope = _workspace_scope_filter(workspace_id)
        if workspace_scope:
            rows = await select_all_trusted(
                "files",
                FILE_COLUMNS,
                filters={"id": file_ids, "workspace_id": workspace_scope},
            )
            w_ids = set(workspace_scope) if isinstance(workspace_scope, list) else {workspace_scope}
            scoped_rows = [row for row in rows if str(row.get("workspace_id") or "") in w_ids]
        else:
            rows = await select_all(
                "files",
                FILE_COLUMNS,
                filters={"id": file_ids, "user_id": user_id},
            )
            scoped_rows = [row for row in rows if not row.get("workspace_id")]

        return {str(row["id"]): row for row in scoped_rows if row.get("id")}

    @staticmethod
    def _assign_chunk_indexes(results: list[RetrievalResult]) -> None:
        by_file: dict[str, list[RetrievalResult]] = {}
        for result in results:
            by_file.setdefault(result.file_id or result.chunk_id, []).append(result)

        for file_results in by_file.values():
            file_results.sort(key=lambda item: (item.created_at or "", item.chunk_id))
            for index, result in enumerate(file_results):
                if result.chunk_index is None:
                    result.chunk_index = index
