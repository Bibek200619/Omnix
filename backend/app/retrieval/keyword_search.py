from __future__ import annotations

import logging
import math
import re
import time
from typing import Any

from starlette.concurrency import run_in_threadpool

from ..db.supabase_client import get_supabase
from ..services.supabase_service import execute_query_sync
from .scoring import RetrievalResult

logger = logging.getLogger(__name__)

DOCUMENT_COLUMNS = "id,content,file_id,created_at,workspace_id,user_id,chunk_index"
FILE_COLUMNS = "id,file_name,metadata,workspace_id,user_id"
_TERM_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/#-]*")


class KeywordSearch:
    """PostgreSQL full-text keyword retrieval with a bounded Python fallback."""

    async def search(
        self,
        query: str,
        *,
        user_id: str,
        workspace_id: str | None = None,
        top_k: int = 3,
    ) -> list[RetrievalResult]:
        started_at = time.perf_counter()
        if not query or not query.strip():
            return []
        if not user_id:
            raise ValueError("user_id is required for keyword retrieval.")

        try:
            rows = await run_in_threadpool(
                self._keyword_rpc_sync,
                query.strip(),
                user_id,
                workspace_id,
                top_k,
            )
        except Exception:
            logger.exception("PostgreSQL keyword RPC failed; using bounded fallback.")
            rows = await run_in_threadpool(
                self._fallback_search_sync,
                query.strip(),
                user_id,
                workspace_id,
                top_k,
            )

        results = [self._row_to_result(row) for row in rows if (row.get("content") or "").strip()]
        self._assign_chunk_indexes(results)
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.info("Keyword search completed: matches=%d, latency_ms=%.2f.", len(results), elapsed_ms)
        return results

    @staticmethod
    def _keyword_rpc_sync(
        query: str,
        user_id: str,
        workspace_id: str | None,
        top_k: int,
    ) -> list[dict[str, Any]]:
        response = execute_query_sync(
            get_supabase().rpc(
                "search_documents_keyword",
                {
                    "q": query,
                    "p_top_k": top_k,
                    "p_user": user_id,
                    "p_workspace": workspace_id,
                },
            ),
            operation="keyword retrieval rpc",
        )
        return list(getattr(response, "data", None) or [])

    def _fallback_search_sync(
        self,
        query: str,
        user_id: str,
        workspace_id: str | None,
        top_k: int,
    ) -> list[dict[str, Any]]:
        supabase = get_supabase()
        doc_query = supabase.table("documents").select(DOCUMENT_COLUMNS)
        if workspace_id:
            doc_query = doc_query.eq("workspace_id", workspace_id)
        else:
            doc_query = doc_query.eq("user_id", user_id)

        response = execute_query_sync(
            doc_query.limit(max(top_k * 50, 100)),
            operation="keyword retrieval fallback documents",
        )
        docs = list(getattr(response, "data", None) or [])
        if workspace_id:
            docs = [row for row in docs if str(row.get("workspace_id") or "") == workspace_id]
        else:
            docs = [row for row in docs if not row.get("workspace_id")]

        file_ids = sorted({str(row["file_id"]) for row in docs if row.get("file_id")})
        files_map = self._fetch_files_sync(file_ids, user_id=user_id, workspace_id=workspace_id)

        scored_rows: list[dict[str, Any]] = []
        for doc in docs:
            file_id = str(doc.get("file_id")) if doc.get("file_id") else None
            file_row = files_map.get(file_id or "", {})
            score = self._score_fallback(query, doc.get("content") or "", file_row)
            if score <= 0:
                continue
            scored_rows.append(
                {
                    **doc,
                    "rank": score,
                    "file_name": file_row.get("file_name") or "Unknown File",
                    "file_metadata": file_row.get("metadata") or {},
                }
            )

        scored_rows.sort(key=lambda row: float(row.get("rank") or 0.0), reverse=True)
        return scored_rows[:top_k]

    @staticmethod
    def _fetch_files_sync(
        file_ids: list[str],
        *,
        user_id: str,
        workspace_id: str | None,
    ) -> dict[str, dict[str, Any]]:
        if not file_ids:
            return {}

        query = get_supabase().table("files").select(FILE_COLUMNS).in_("id", file_ids)
        if workspace_id:
            query = query.eq("workspace_id", workspace_id)
        else:
            query = query.eq("user_id", user_id)

        response = execute_query_sync(query, operation="keyword retrieval fallback files")
        rows = list(getattr(response, "data", None) or [])
        if workspace_id:
            rows = [row for row in rows if str(row.get("workspace_id") or "") == workspace_id]
        else:
            rows = [row for row in rows if not row.get("workspace_id")]
        return {str(row["id"]): row for row in rows if row.get("id")}

    @staticmethod
    def _score_fallback(query: str, content: str, file_row: dict[str, Any]) -> float:
        normalized_query = query.lower().strip()
        if not normalized_query:
            return 0.0

        haystacks = [
            (content or "").lower(),
            (file_row.get("file_name") or "").lower(),
            str(file_row.get("metadata") or {}).lower(),
        ]
        weights = [1.0, 0.8, 0.4]
        score = 0.0
        for haystack, weight in zip(haystacks, weights):
            if not haystack:
                continue
            if normalized_query in haystack:
                score += 5.0 * weight
            for term in _important_terms(query):
                occurrences = haystack.count(term.lower())
                if occurrences:
                    score += math.sqrt(occurrences) * weight
        return score

    @staticmethod
    def _row_to_result(row: dict[str, Any]) -> RetrievalResult:
        rank = float(row.get("rank") or row.get("score") or 0.0)
        metadata = row.get("file_metadata") or row.get("metadata") or {}
        return RetrievalResult(
            chunk_id=str(row.get("id") or row.get("chunk_id") or ""),
            content=(row.get("content") or "").strip(),
            file_id=str(row.get("file_id")) if row.get("file_id") else None,
            file_name=row.get("file_name") or "Unknown File",
            workspace_id=str(row.get("workspace_id")) if row.get("workspace_id") else None,
            user_id=str(row.get("user_id")) if row.get("user_id") else None,
            created_at=str(row.get("created_at")) if row.get("created_at") else None,
            metadata=metadata if isinstance(metadata, dict) else {"raw": metadata},
            chunk_index=int(row["chunk_index"]) if row.get("chunk_index") is not None else None,
            keyword_score=rank,
            rank=rank,
            sources={"keyword"},
            diagnostics={"ts_rank": rank},
        )

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


def _important_terms(query: str) -> list[str]:
    terms = _TERM_RE.findall(query or "")
    if not terms:
        return [query.strip()] if query.strip() else []
    return [term for term in terms if len(term) > 1]
