from __future__ import annotations

import logging
import math
import re
import uuid
from dataclasses import dataclass
from typing import Any

from ..rag.chunking import chunk_text
from ..retrieval.context_builder import BuiltContext, ContextBuilder, ContextSupplement
from ..retrieval.scoring import RetrievalResult
from ..services.supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_many,
    select_all,
    select_all_trusted,
)
from ..services.workspace_service import utc_now_iso

logger = logging.getLogger(__name__)

DOCUMENT_COLUMNS = "id,content,file_id,created_at,workspace_id,user_id,chunk_index"
FILE_COLUMNS = "id,user_id,workspace_id,conversation_id,file_name,file_type,metadata,created_at"
MAX_IMMEDIATE_CHUNKS = 250
_TERM_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/#-]*")
_GENERIC_DOCUMENT_RE = re.compile(
    r"\b(this|the|uploaded|attached|file|document|doc|pdf|docx|analy[sz]e|summari[sz]e|review)\b",
    re.IGNORECASE,
)


@dataclass(slots=True)
class StoredDocumentChunks:
    chunk_count: int
    chunk_ids: list[str]
    truncated: bool = False


def _important_terms(query: str) -> list[str]:
    return [term.lower() for term in _TERM_RE.findall(query or "") if len(term) > 2]


def _is_generic_document_query(query: str) -> bool:
    terms = _important_terms(query)
    if not terms:
        return True
    matched = _GENERIC_DOCUMENT_RE.findall(query or "")
    return len(matched) >= max(1, math.ceil(len(terms) * 0.5))


def _score_chunk(query: str, chunk: str, file_row: dict[str, Any]) -> float:
    terms = _important_terms(query)
    if not terms:
        return 0.0

    haystacks = [
        (chunk or "").lower(),
        (file_row.get("file_name") or "").lower(),
        str(file_row.get("metadata") or {}).lower(),
    ]
    weights = [1.0, 0.8, 0.25]
    score = 0.0
    normalized_query = (query or "").lower().strip()

    for haystack, weight in zip(haystacks, weights):
        if not haystack:
            continue
        if normalized_query and normalized_query in haystack:
            score += 4.0 * weight
        for term in terms:
            occurrences = haystack.count(term)
            if occurrences:
                score += math.sqrt(occurrences) * weight

    return score


async def store_extracted_text_chunks(
    *,
    file_id: str,
    user_id: str,
    text: str,
    workspace_id: str | None = None,
    replace_existing: bool = False,
) -> StoredDocumentChunks:
    """Persist lightweight text chunks immediately so chat can retrieve uploads without a worker.

    Embeddings are intentionally not generated here. The async ingestion worker can replace these
    rows later with embedded rows, while keyword and fallback retrieval work right away.
    """
    normalized_text = (text or "").strip()
    if not normalized_text:
        return StoredDocumentChunks(chunk_count=0, chunk_ids=[])

    chunks = chunk_text(normalized_text, metadata={"ingestion_stage": "immediate"})
    if not chunks:
        return StoredDocumentChunks(chunk_count=0, chunk_ids=[])

    truncated = len(chunks) > MAX_IMMEDIATE_CHUNKS
    chunks = chunks[:MAX_IMMEDIATE_CHUNKS]

    if replace_existing:
        await delete_many_trusted("documents", {"file_id": file_id})

    timestamp = utc_now_iso()
    payloads: list[dict[str, Any]] = []
    chunk_ids: list[str] = []
    for index, chunk in enumerate(chunks):
        chunk_id = str(uuid.uuid4())
        chunk_ids.append(chunk_id)
        payload: dict[str, Any] = {
            "id": chunk_id,
            "user_id": user_id,
            "file_id": file_id,
            "content": str(chunk["content"]),
            "chunk_index": index,
            "created_at": timestamp,
        }
        if workspace_id:
            payload["workspace_id"] = workspace_id
        payloads.append(payload)

    await insert_many("documents", payloads)
    return StoredDocumentChunks(chunk_count=len(payloads), chunk_ids=chunk_ids, truncated=truncated)


async def build_uploaded_document_context(
    query: str,
    *,
    user_id: str,
    conversation_id: str | None,
    workspace_id: str | None,
    scope_workspace_ids: list[str] | None = None,
    top_k: int = 3,
    supplemental_contexts: list[ContextSupplement | dict[str, Any]] | None = None,
) -> BuiltContext | None:
    """Build prompt context from uploaded document chunks when vector retrieval has no hit."""
    files = await _load_candidate_files(
        user_id=user_id,
        conversation_id=conversation_id,
        workspace_id=workspace_id,
        scope_workspace_ids=scope_workspace_ids,
    )
    if not files:
        return None

    file_ids = [str(file_row["id"]) for file_row in files if file_row.get("id")]
    documents = await _load_document_chunks(
        file_ids,
        user_id=user_id,
        workspace_id=workspace_id,
        scope_workspace_ids=scope_workspace_ids,
    )
    if not documents:
        logger.info(
            "Uploaded document retrieval found files but no chunks: conversation_id=%s workspace_id=%s files=%d.",
            conversation_id,
            workspace_id,
            len(files),
        )
        return None

    file_by_id = {str(file_row["id"]): file_row for file_row in files if file_row.get("id")}
    file_order = {file_id: index for index, file_id in enumerate(file_ids)}
    generic_query = _is_generic_document_query(query)
    results: list[RetrievalResult] = []
    logger.info(
        "Uploaded document retrieval scan: conversation_id=%s workspace_id=%s files=%d chunks=%d generic_query=%s.",
        conversation_id,
        workspace_id,
        len(files),
        len(documents),
        generic_query,
    )

    for row in documents:
        content = (row.get("content") or "").strip()
        if not content:
            continue
        file_id = str(row.get("file_id")) if row.get("file_id") else None
        file_row = file_by_id.get(file_id or "", {})
        lexical_score = _score_chunk(query, content, file_row)
        recency_score = max(0.0, 1.0 - (file_order.get(file_id or "", 999) * 0.05))
        if not generic_query and lexical_score <= 0:
            continue
        score = recency_score if generic_query else lexical_score + (recency_score * 0.15)

        results.append(
            RetrievalResult(
                chunk_id=str(row.get("id") or ""),
                content=content,
                file_id=file_id,
                file_name=file_row.get("file_name") or "Uploaded document",
                workspace_id=str(row.get("workspace_id")) if row.get("workspace_id") else None,
                user_id=str(row.get("user_id")) if row.get("user_id") else None,
                created_at=str(row.get("created_at")) if row.get("created_at") else None,
                metadata=file_row.get("metadata") if isinstance(file_row.get("metadata"), dict) else {},
                chunk_index=int(row["chunk_index"]) if row.get("chunk_index") is not None else None,
                keyword_score=score,
                score=score,
                sources={"uploaded_document"},
            )
        )

    if not results:
        return None

    results.sort(
        key=lambda item: (
            item.score,
            -file_order.get(item.file_id or "", 999),
            item.created_at or "",
        ),
        reverse=True,
    )
    _assign_chunk_indexes(results)

    builder = ContextBuilder(
        max_chunks=max(top_k, top_k + len(supplemental_contexts or [])),
        token_budget=3200,
        max_chunk_tokens=700,
    )
    built = builder.build(
        query,
        results[: max(top_k * 3, top_k)],
        workspace_id=workspace_id,
        supplemental_contexts=supplemental_contexts,
    )
    if not built.sources:
        return None
    built.diagnostics["fallback"] = "uploaded_document_context"
    first_preview = (
        built.chunks[0].get("content", "") if built.chunks else built.sources[0].get("chunk_preview", "")
    )
    logger.info(
        "Uploaded document retrieval built context: sources=%d chunks=%d prompt_length=%d first_chunk_preview=%r.",
        len(built.sources),
        len(built.chunks),
        len(built.prompt),
        str(first_preview).replace("\n", " ")[:240],
    )
    return built


async def _load_candidate_files(
    *,
    user_id: str,
    conversation_id: str | None,
    workspace_id: str | None,
    scope_workspace_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    if conversation_id:
        conversation_files = await _select_files(
            user_id=user_id,
            workspace_id=workspace_id,
            scope_workspace_ids=scope_workspace_ids,
            filters={"conversation_id": conversation_id},
            limit=10,
        )
        if conversation_files:
            return conversation_files

    return await _select_files(
        user_id=user_id,
        workspace_id=workspace_id,
        scope_workspace_ids=scope_workspace_ids,
        filters={},
        limit=10,
    )


async def _select_files(
    *,
    user_id: str,
    workspace_id: str | None,
    scope_workspace_ids: list[str] | None,
    filters: dict[str, Any],
    limit: int,
) -> list[dict[str, Any]]:
    try:
        workspace_ids = [
            str(item)
            for item in (scope_workspace_ids or ([workspace_id] if workspace_id else []))
            if str(item or "").strip()
        ]
        if workspace_ids:
            scoped_filters = {"workspace_id": workspace_ids, **filters}
            rows = await select_all_trusted(
                "files",
                FILE_COLUMNS,
                filters=scoped_filters,
                order_by="created_at",
                desc=True,
                limit=limit,
            )
            scope_set = set(workspace_ids)
            return [row for row in rows if str(row.get("workspace_id") or "") in scope_set]

        scoped_filters = {"user_id": user_id, **filters}
        rows = await select_all(
            "files",
            FILE_COLUMNS,
            filters=scoped_filters,
            order_by="created_at",
            desc=True,
            limit=limit,
        )
        return [row for row in rows if str(row.get("user_id") or "") == user_id and not row.get("workspace_id")]
    except SupabaseServiceError:
        logger.exception("Failed to load candidate uploaded files.")
        return []


async def _load_document_chunks(
    file_ids: list[str],
    *,
    user_id: str,
    workspace_id: str | None,
    scope_workspace_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    if not file_ids:
        return []

    try:
        workspace_ids = [
            str(item)
            for item in (scope_workspace_ids or ([workspace_id] if workspace_id else []))
            if str(item or "").strip()
        ]
        if workspace_ids:
            rows = await select_all_trusted(
                "documents",
                DOCUMENT_COLUMNS,
                filters={"file_id": file_ids, "workspace_id": workspace_ids},
                order_by="created_at",
                limit=500,
            )
            scope_set = set(workspace_ids)
            return [row for row in rows if str(row.get("workspace_id") or "") in scope_set]

        rows = await select_all(
            "documents",
            DOCUMENT_COLUMNS,
            filters={"file_id": file_ids, "user_id": user_id},
            order_by="created_at",
            limit=500,
        )
        return [row for row in rows if str(row.get("user_id") or "") == user_id and not row.get("workspace_id")]
    except SupabaseServiceError:
        logger.exception("Failed to load uploaded document chunks.")
        return []


def _assign_chunk_indexes(results: list[RetrievalResult]) -> None:
    by_file: dict[str, list[RetrievalResult]] = {}
    for result in results:
        by_file.setdefault(result.file_id or result.chunk_id, []).append(result)

    for file_results in by_file.values():
        file_results.sort(key=lambda item: (item.created_at or "", item.chunk_id))
        for index, result in enumerate(file_results):
            if result.chunk_index is None:
                result.chunk_index = index
