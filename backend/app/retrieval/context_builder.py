from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any

from .scoring import (
    RetrievalResult,
    content_fingerprint,
    estimate_tokens,
    normalize_content,
    truncate_to_token_budget,
)


@dataclass(slots=True)
class ContextSupplement:
    content: str
    title: str = "Context"
    source_type: str = "supplemental"
    source_id: str | None = None
    workspace_id: str | None = None
    score: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class BuiltContext:
    prompt: str
    context_text: str
    sources: list[dict[str, Any]]
    chunks: list[dict[str, Any]]
    diagnostics: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "prompt": self.prompt,
            "context_text": self.context_text,
            "sources": self.sources,
            "chunks": self.chunks,
            "diagnostics": self.diagnostics,
        }


@dataclass(slots=True)
class _ContextCandidate:
    content: str
    title: str
    source_type: str
    source_id: str | None
    file_id: str | None
    chunk_index: int | None
    workspace_id: str | None
    score: float
    rank_position: int
    result: RetrievalResult | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class ContextBuilder:
    """Token-aware context assembler that preserves source boundaries and citations."""

    def __init__(
        self,
        *,
        max_chunks: int = 6,
        token_budget: int = 2600,
        max_chunk_tokens: int = 650,
    ) -> None:
        self.max_chunks = max(1, max_chunks)
        self.token_budget = max(256, token_budget)
        self.max_chunk_tokens = max(128, max_chunk_tokens)

    def build(
        self,
        query: str,
        results: list[RetrievalResult],
        *,
        workspace_id: str | None = None,
        supplemental_contexts: list[ContextSupplement | dict[str, Any]] | None = None,
    ) -> BuiltContext:
        candidates = self._candidates_from_results(results, workspace_id=workspace_id)
        candidates.extend(self._candidates_from_supplements(supplemental_contexts or [], workspace_id=workspace_id))

        selected = self._select_diverse_candidates(candidates)
        context_blocks: list[str] = []
        sources: list[dict[str, Any]] = []
        chunks: list[dict[str, Any]] = []
        used_tokens = 0

        for source_number, candidate in enumerate(selected, start=1):
            label = f"S{source_number}"
            header = self._format_header(label, candidate)
            header_tokens = estimate_tokens(header)
            remaining = self.token_budget - used_tokens - header_tokens
            if remaining <= 24:
                break

            chunk_budget = min(self.max_chunk_tokens, remaining)
            content = truncate_to_token_budget(candidate.content, chunk_budget)
            if not content:
                continue

            block = f"{header}\n{content}"
            block_tokens = estimate_tokens(block)
            if used_tokens + block_tokens > self.token_budget:
                continue

            context_blocks.append(block)
            used_tokens += block_tokens
            sources.append(self._source_payload(label, candidate, content))
            chunks.append(self._chunk_payload(label, candidate, content))

        context_text = "\n\n".join(context_blocks) if context_blocks else "No relevant context found."
        clean_query = (query or "").strip()
        prompt = (
            "You are Omnix AI.\n\n"
            "Use the following retrieved document context to answer the user's question.\n\n"
            "DOCUMENT CONTEXT:\n"
            f"{context_text}\n\n"
            "USER QUESTION:\n"
            f"{clean_query}\n\n"
            "IMPORTANT:\n"
            "- If document context is provided, answer from that content first.\n"
            "- Do not say you cannot access uploaded files; the document context above is the accessible uploaded content.\n"
            "- If the answer is not present in the document context, say that it is not in the uploaded document.\n"
        )

        return BuiltContext(
            prompt=prompt,
            context_text=context_text,
            sources=sources,
            chunks=chunks,
            diagnostics={
                "candidate_count": len(candidates),
                "selected_count": len(chunks),
                "estimated_context_tokens": used_tokens,
                "token_budget": self.token_budget,
            },
        )

    def _candidates_from_results(
        self,
        results: list[RetrievalResult],
        *,
        workspace_id: str | None,
    ) -> list[_ContextCandidate]:
        candidates: list[_ContextCandidate] = []
        seen_chunks: set[str] = set()
        seen_content: set[str] = set()

        for position, result in enumerate(results):
            if not self._result_in_workspace(result, workspace_id):
                continue
            content = (result.content or "").strip()
            if not content:
                continue
            chunk_key = result.key()
            content_key = content_fingerprint(content)
            if chunk_key in seen_chunks or content_key in seen_content:
                continue
            seen_chunks.add(chunk_key)
            seen_content.add(content_key)
            candidates.append(
                _ContextCandidate(
                    content=content,
                    title=result.file_name or "Unknown File",
                    source_type="retrieval",
                    source_id=result.chunk_id,
                    file_id=result.file_id,
                    chunk_index=result.chunk_index,
                    workspace_id=result.workspace_id,
                    score=result.rerank_score if result.rerank_score is not None else result.score,
                    rank_position=position,
                    result=result,
                    metadata=dict(result.metadata or {}),
                )
            )

        return candidates

    @staticmethod
    def _result_in_workspace(result: RetrievalResult, workspace_id: str | None) -> bool:
        if workspace_id:
            return result.workspace_id == workspace_id
        return result.workspace_id is None

    def _candidates_from_supplements(
        self,
        supplements: list[ContextSupplement | dict[str, Any]],
        *,
        workspace_id: str | None,
    ) -> list[_ContextCandidate]:
        candidates: list[_ContextCandidate] = []
        offset = 100000
        seen_content: set[str] = set()

        for index, item in enumerate(supplements):
            supplement = self._coerce_supplement(item)
            if workspace_id and supplement.workspace_id != workspace_id:
                continue
            if workspace_id is None and supplement.workspace_id is not None:
                continue
            content = supplement.content.strip()
            if not content:
                continue
            content_key = content_fingerprint(content)
            if content_key in seen_content:
                continue
            seen_content.add(content_key)
            candidates.append(
                _ContextCandidate(
                    content=content,
                    title=supplement.title or "Context",
                    source_type=supplement.source_type,
                    source_id=supplement.source_id,
                    file_id=None,
                    chunk_index=None,
                    workspace_id=supplement.workspace_id,
                    score=supplement.score,
                    rank_position=offset + index,
                    metadata=supplement.metadata,
                )
            )

        return candidates

    @staticmethod
    def _coerce_supplement(item: ContextSupplement | dict[str, Any]) -> ContextSupplement:
        if isinstance(item, ContextSupplement):
            return item
        return ContextSupplement(
            content=str(item.get("content") or ""),
            title=str(item.get("title") or "Context"),
            source_type=str(item.get("source_type") or item.get("type") or "supplemental"),
            source_id=str(item.get("id") or item.get("source_id")) if item.get("id") or item.get("source_id") else None,
            workspace_id=str(item.get("workspace_id")) if item.get("workspace_id") else None,
            score=float(item.get("score") or 0.0),
            metadata=item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
        )

    def _select_diverse_candidates(self, candidates: list[_ContextCandidate]) -> list[_ContextCandidate]:
        ranked = sorted(
            candidates,
            key=lambda item: (item.score, -item.rank_position),
            reverse=True,
        )
        selected: list[_ContextCandidate] = []
        selected_keys: set[str] = set()
        per_file_counts: dict[str, int] = {}
        first_pass_file_limit = max(2, math.ceil(self.max_chunks / 2))

        def try_add(candidate: _ContextCandidate, enforce_file_limit: bool) -> bool:
            if len(selected) >= self.max_chunks:
                return False
            text_key = normalize_content(candidate.content[:2000])
            if text_key in selected_keys:
                return False
            file_key = candidate.file_id or candidate.title or candidate.source_id or "unknown"
            if enforce_file_limit and per_file_counts.get(file_key, 0) >= first_pass_file_limit:
                return False
            selected.append(candidate)
            selected_keys.add(text_key)
            per_file_counts[file_key] = per_file_counts.get(file_key, 0) + 1
            return True

        for candidate in ranked:
            try_add(candidate, enforce_file_limit=True)

        if len(selected) < self.max_chunks:
            for candidate in ranked:
                try_add(candidate, enforce_file_limit=False)

        return self._order_selected_chunks(selected)

    @staticmethod
    def _order_selected_chunks(selected: list[_ContextCandidate]) -> list[_ContextCandidate]:
        first_rank_by_file: dict[str, int] = {}
        for candidate in selected:
            file_key = candidate.file_id or candidate.source_id or candidate.title
            first_rank_by_file[file_key] = min(first_rank_by_file.get(file_key, candidate.rank_position), candidate.rank_position)

        return sorted(
            selected,
            key=lambda item: (
                first_rank_by_file.get(item.file_id or item.source_id or item.title, item.rank_position),
                item.chunk_index if item.chunk_index is not None else item.rank_position,
                item.rank_position,
            ),
        )

    @staticmethod
    def _format_header(label: str, candidate: _ContextCandidate) -> str:
        parts = [f"[{label}]", candidate.title]
        if candidate.chunk_index is not None:
            parts.append(f"chunk {candidate.chunk_index}")
        if candidate.source_type != "retrieval":
            parts.append(candidate.source_type)
        return " | ".join(str(part) for part in parts if part)

    @staticmethod
    def _source_payload(label: str, candidate: _ContextCandidate, content: str) -> dict[str, Any]:
        score = float(candidate.score or 0.0)
        preview = content[:200]
        result_payload = candidate.result.to_dict() if candidate.result is not None else {}
        return {
            "id": candidate.source_id,
            "label": label,
            "type": candidate.source_type,
            "title": candidate.title,
            "excerpt": f"[{label}] " + preview[:100] + ("..." if len(preview) > 100 else ""),
            "score": score,
            "chunk_index": candidate.chunk_index,
            "file_id": candidate.file_id,
            "chunk_preview": preview,
            "retrieval_sources": result_payload.get("retrieval_sources", []),
            "semantic_score": result_payload.get("semantic_score"),
            "keyword_score": result_payload.get("keyword_score"),
            "metadata": candidate.metadata,
        }

    @staticmethod
    def _chunk_payload(label: str, candidate: _ContextCandidate, content: str) -> dict[str, Any]:
        if candidate.result is not None:
            payload = candidate.result.to_dict()
        else:
            payload = {
                "chunk_id": candidate.source_id,
                "file_id": candidate.file_id,
                "file_name": candidate.title,
                "workspace_id": candidate.workspace_id,
                "metadata": candidate.metadata,
                "score": candidate.score,
                "retrieval_sources": [candidate.source_type],
            }
        payload["content"] = content
        payload["source_label"] = label
        payload["source_type"] = candidate.source_type
        return payload
