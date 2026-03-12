from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import math
import re
from typing import Any


DEFAULT_SEMANTIC_WEIGHT = 0.7
DEFAULT_KEYWORD_WEIGHT = 0.3

_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/#-]*")
_FILENAME_RE = re.compile(r"\b[\w .()#-]+\.[A-Za-z0-9]{1,8}\b")
_UUID_RE = re.compile(
    r"\b[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}\b"
)
_TECHNICAL_TOKEN_RE = re.compile(
    r"(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9][A-Za-z0-9_.:/#-]{2,}"
    r"|[A-Z]{2,}\d*"
    r"|[A-Za-z_]+::[A-Za-z_]+"
    r"|[A-Za-z_]+/[A-Za-z0-9_.-]+"
)
_QUESTION_WORDS = {"why", "how", "what", "explain", "summarize", "compare", "describe", "relationship"}


@dataclass(slots=True)
class QueryAnalysis:
    query: str
    normalized_query: str
    tokens: list[str]
    is_exact: bool
    is_short: bool
    is_filename_lookup: bool
    is_entity_heavy: bool
    is_technical: bool
    is_semantic: bool
    semantic_weight: float
    keyword_weight: float
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "tokens": self.tokens,
            "is_exact": self.is_exact,
            "is_short": self.is_short,
            "is_filename_lookup": self.is_filename_lookup,
            "is_entity_heavy": self.is_entity_heavy,
            "is_technical": self.is_technical,
            "is_semantic": self.is_semantic,
            "semantic_weight": self.semantic_weight,
            "keyword_weight": self.keyword_weight,
            "reasons": list(self.reasons),
        }


@dataclass(slots=True)
class RetrievalScoreConfig:
    semantic_weight: float = DEFAULT_SEMANTIC_WEIGHT
    keyword_weight: float = DEFAULT_KEYWORD_WEIGHT
    dynamic_weighting: bool = True
    semantic_distance_threshold: float | None = None


@dataclass(slots=True)
class RetrievalResult:
    chunk_id: str
    content: str
    file_id: str | None = None
    file_name: str = "Unknown File"
    workspace_id: str | None = None
    user_id: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    chunk_index: int | None = None
    semantic_score: float = 0.0
    keyword_score: float = 0.0
    score: float = 0.0
    rerank_score: float | None = None
    distance: float | None = None
    rank: float | None = None
    sources: set[str] = field(default_factory=set)
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def key(self) -> str:
        if self.chunk_id:
            return self.chunk_id
        return content_fingerprint(self.content)

    def clone(self) -> "RetrievalResult":
        return RetrievalResult(
            chunk_id=self.chunk_id,
            content=self.content,
            file_id=self.file_id,
            file_name=self.file_name,
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            created_at=self.created_at,
            metadata=dict(self.metadata or {}),
            chunk_index=self.chunk_index,
            semantic_score=self.semantic_score,
            keyword_score=self.keyword_score,
            score=self.score,
            rerank_score=self.rerank_score,
            distance=self.distance,
            rank=self.rank,
            sources=set(self.sources),
            diagnostics=dict(self.diagnostics or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        score_value = self.rerank_score if self.rerank_score is not None else self.score
        return {
            "chunk_id": self.chunk_id,
            "content": self.content,
            "file_id": self.file_id,
            "file_name": self.file_name,
            "workspace_id": self.workspace_id,
            "user_id": self.user_id,
            "created_at": self.created_at,
            "metadata": self.metadata,
            "chunk_index": self.chunk_index,
            "semantic_score": self.semantic_score,
            "keyword_score": self.keyword_score,
            "score": score_value,
            "hybrid_score": self.score,
            "rerank_score": self.rerank_score,
            "distance": self.distance,
            "rank": self.rank,
            "retrieval_sources": sorted(self.sources),
            "diagnostics": self.diagnostics,
        }


def analyze_query(
    query: str,
    *,
    base_semantic_weight: float = DEFAULT_SEMANTIC_WEIGHT,
    base_keyword_weight: float = DEFAULT_KEYWORD_WEIGHT,
) -> QueryAnalysis:
    clean = " ".join((query or "").strip().split())
    normalized = clean.lower()
    tokens = _TOKEN_RE.findall(clean)
    token_count = len(tokens)
    quoted = bool(re.search(r"(['\"]).+?\1", clean))
    filename_lookup = bool(_FILENAME_RE.search(clean)) or any(
        word in normalized for word in ("file named", "filename", "document named", "spreadsheet", "pdf")
    )
    technical_tokens = [token for token in tokens if _TECHNICAL_TOKEN_RE.fullmatch(token) or _UUID_RE.fullmatch(token)]
    uppercase_entities = [token for token in tokens if len(token) > 1 and token.isupper()]
    is_short = 0 < token_count <= 3
    is_exact = quoted or bool(_UUID_RE.search(clean)) or bool(technical_tokens and token_count <= 4)
    is_technical = bool(technical_tokens)
    is_entity_heavy = bool(uppercase_entities) or len(technical_tokens) >= 1
    question_terms = {token.lower() for token in tokens[:4]}
    is_semantic = token_count >= 5 or bool(question_terms & _QUESTION_WORDS)

    reasons: list[str] = []
    semantic_weight = base_semantic_weight
    keyword_weight = base_keyword_weight

    if is_semantic:
        semantic_weight, keyword_weight = 0.8, 0.2
        reasons.append("conceptual_query")

    if is_short:
        semantic_weight, keyword_weight = 0.45, 0.55
        reasons.append("short_query")

    if is_exact:
        semantic_weight, keyword_weight = 0.35, 0.65
        reasons.append("exact_or_id_query")

    if is_technical or is_entity_heavy:
        semantic_weight = min(semantic_weight, 0.4)
        keyword_weight = max(keyword_weight, 0.6)
        reasons.append("technical_or_entity_query")

    if filename_lookup:
        semantic_weight, keyword_weight = 0.25, 0.75
        reasons.append("filename_lookup")

    semantic_weight, keyword_weight = normalize_weights(semantic_weight, keyword_weight)

    return QueryAnalysis(
        query=clean,
        normalized_query=normalized,
        tokens=tokens,
        is_exact=is_exact,
        is_short=is_short,
        is_filename_lookup=filename_lookup,
        is_entity_heavy=is_entity_heavy,
        is_technical=is_technical,
        is_semantic=is_semantic,
        semantic_weight=semantic_weight,
        keyword_weight=keyword_weight,
        reasons=reasons or ["default_hybrid"],
    )


def normalize_weights(semantic_weight: float, keyword_weight: float) -> tuple[float, float]:
    semantic_weight = max(0.0, float(semantic_weight))
    keyword_weight = max(0.0, float(keyword_weight))
    total = semantic_weight + keyword_weight
    if total <= 0:
        return DEFAULT_SEMANTIC_WEIGHT, DEFAULT_KEYWORD_WEIGHT
    return semantic_weight / total, keyword_weight / total


def distance_to_similarity(distance: float | None) -> float:
    if distance is None:
        return 0.0
    try:
        value = float(distance)
    except Exception:
        return 0.0
    if not math.isfinite(value) or value < 0:
        return 0.0
    return 1.0 / (1.0 + value)


def normalize_channel_scores(results: list[RetrievalResult], channel: str) -> dict[str, float]:
    attr = "semantic_score" if channel == "semantic" else "keyword_score"
    scored = [(result.key(), float(getattr(result, attr, 0.0) or 0.0)) for result in results]
    positive_scores = [score for _, score in scored if score > 0.0 and math.isfinite(score)]
    if not positive_scores:
        return {}

    max_score = max(positive_scores)
    if max_score <= 0.0:
        return {}
    if all(math.isclose(max_score, score) for score in positive_scores):
        return {key: 1.0 for key, score in scored if score > 0.0 and math.isfinite(score)}

    return {
        key: max(0.0, min(1.0, score / max_score))
        for key, score in scored
        if score > 0.0 and math.isfinite(score)
    }


def content_fingerprint(content: str) -> str:
    normalized = normalize_content(content)
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


def normalize_content(content: str) -> str:
    return re.sub(r"\s+", " ", (content or "").strip().lower())


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    words = len(re.findall(r"\S+", text))
    chars = max(1, len(text))
    return max(words, math.ceil(chars / 4))


def truncate_to_token_budget(text: str, token_budget: int) -> str:
    if token_budget <= 0 or not text:
        return ""
    if estimate_tokens(text) <= token_budget:
        return text.strip()

    words = re.findall(r"\S+\s*", text)
    selected: list[str] = []
    used = 0
    for word in words:
        next_used = estimate_tokens("".join(selected) + word)
        if next_used > token_budget:
            break
        selected.append(word)
        used = next_used

    truncated = "".join(selected).strip()
    if not truncated:
        approx_chars = max(1, token_budget * 4)
        truncated = text[:approx_chars].strip()
    if used < estimate_tokens(text):
        truncated = truncated.rstrip(" .,:;") + "..."
    return truncated
