from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Literal

CitationValidationStatus = Literal["pending", "supported", "incomplete", "unsupported", "not_applicable"]

_CITATION_LABEL_RE = re.compile(r"[SW]\d{1,4}", re.IGNORECASE)
_CITATION_GROUP_RE = re.compile(
    r"\[(?P<labels>[SW]\d{1,4}(?:\s*[,;]\s*[SW]\d{1,4})*)\]",
    re.IGNORECASE,
)
_CODE_SEGMENT_RE = re.compile(r"(```[\s\S]*?```|`[^`\n]*`)")


@dataclass(frozen=True, slots=True)
class CitationValidation:
    content: str
    citations: tuple[str, ...]
    status: CitationValidationStatus
    source_count: int
    invalid_citation_count: int

    @property
    def public_payload(self) -> dict[str, str | int]:
        return {
            "status": self.status,
            "source_count": self.source_count,
            "cited_source_count": len(self.citations),
            "invalid_citation_count": self.invalid_citation_count,
        }

    def stream_payload(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "citations": list(self.citations),
            "citation_validation": self.public_payload,
        }


def _source_labels(sources: list[dict[str, Any]]) -> dict[str, str]:
    labels: dict[str, str] = {}
    for source in sources[:12]:
        if not isinstance(source, dict):
            continue
        value = source.get("label")
        if not isinstance(value, str):
            continue
        label = value.strip()
        if _CITATION_LABEL_RE.fullmatch(label):
            labels.setdefault(label.upper(), label.upper())

    context_labels = {key: value for key, value in labels.items() if key.startswith("S")}
    return context_labels or labels


def _validation_status(
    *,
    source_count: int,
    citations: tuple[str, ...],
    invalid_citation_count: int,
) -> CitationValidationStatus:
    if source_count == 0:
        return "not_applicable"
    if citations and invalid_citation_count == 0:
        return "supported"
    if citations:
        return "incomplete"
    return "unsupported" if invalid_citation_count else "incomplete"


def pending_citation_validation(sources: list[dict[str, Any]]) -> CitationValidation:
    source_count = len(_source_labels(sources))
    return CitationValidation(
        content="",
        citations=(),
        status="pending" if source_count else "not_applicable",
        source_count=source_count,
        invalid_citation_count=0,
    )


def validate_generated_citations(content: str, sources: list[dict[str, Any]]) -> CitationValidation:
    """Keep only generated citation labels backed by the assembled source context."""
    labels = _source_labels(sources)
    citations: list[str] = []
    invalid_citation_count = 0

    def replace_group(match: re.Match[str]) -> str:
        nonlocal invalid_citation_count
        verified: list[str] = []
        for raw_label in re.split(r"\s*[,;]\s*", match.group("labels")):
            label = labels.get(raw_label.upper())
            if label is None:
                invalid_citation_count += 1
                continue
            if label not in verified:
                verified.append(label)
            if label not in citations:
                citations.append(label)
        return f"[{', '.join(verified)}]" if verified else ""

    segments = _CODE_SEGMENT_RE.split(content or "")
    for index in range(0, len(segments), 2):
        invalid_before = invalid_citation_count
        segments[index] = _CITATION_GROUP_RE.sub(replace_group, segments[index])
        segments[index] = re.sub(r"[ \t]+([,.;:!?])", r"\1", segments[index])
        if invalid_citation_count > invalid_before:
            segments[index] = re.sub(r"(?<=\S)[ \t]{2,}(?=\S)", " ", segments[index])

    verified_citations = tuple(citations)
    return CitationValidation(
        content="".join(segments),
        citations=verified_citations,
        status=_validation_status(
            source_count=len(labels),
            citations=verified_citations,
            invalid_citation_count=invalid_citation_count,
        ),
        source_count=len(labels),
        invalid_citation_count=invalid_citation_count,
    )


def finalize_generated_context_result(result: dict[str, Any]) -> dict[str, Any]:
    """Filter a ContextEngine action or insight result down to citations used by its answer."""
    content = result.get("markdown")
    sources = result.get("citations")
    if not isinstance(content, str) or not isinstance(sources, list):
        return result

    source_records = [source for source in sources if isinstance(source, dict)]
    validation = validate_generated_citations(content, source_records)
    verified_labels = set(validation.citations)
    finalized = dict(result)
    finalized["markdown"] = validation.content
    for key in ("faq_text", "tasks_text", "structured_text"):
        if finalized.get(key) == content:
            finalized[key] = validation.content
    finalized["citations"] = [
        source
        for source in source_records
        if isinstance(source.get("label"), str) and source["label"].upper() in verified_labels
    ]
    finalized["citation_validation"] = validation.public_payload
    return finalized
