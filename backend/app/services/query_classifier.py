from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import re
from typing import Literal

SearchMode = Literal["auto", "workspace", "web", "hybrid"]


_CURRENT_TERMS = re.compile(
    r"\b("
    r"latest|today|tonight|yesterday|tomorrow|current|currently|now|new|newest|recent|recently|"
    r"breaking|news|headline|headlines|trend|trends|trending|live|real[-\s]?time|up[-\s]?to[-\s]?date|"
    r"this\s+(week|month|quarter|year)|as\s+of|market|release|launched|announced"
    r")\b",
    re.IGNORECASE,
)
_VOLATILE_TOPICS = re.compile(
    r"\b("
    r"price|prices|stock|stocks|earnings|funding|acquisition|ipo|layoff|lawsuit|election|poll|"
    r"weather|forecast|schedule|score|standings|ranking|benchmark|version|changelog|security advisory|"
    r"vulnerability|cve|policy|regulation|rate|exchange rate"
    r")\b",
    re.IGNORECASE,
)
_WEB_REFERENCES = re.compile(r"\b(web|internet|online|browse|search|sources?|cite|citations?)\b", re.IGNORECASE)
_DOCUMENT_ONLY = re.compile(
    r"\b(uploaded|attached|this document|the document|workspace notes|our docs|internal|private knowledge)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SearchDecision:
    requested_mode: SearchMode
    effective_mode: SearchMode
    needs_web: bool
    confidence: float
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {
            "requested_mode": self.requested_mode,
            "effective_mode": self.effective_mode,
            "needs_web": self.needs_web,
            "confidence": round(self.confidence, 2),
            "reasons": self.reasons,
        }


def _contains_current_year(query: str) -> bool:
    current_year = datetime.now(UTC).year
    years = [int(value) for value in re.findall(r"\b20\d{2}\b", query or "")]
    return any(year >= current_year - 1 for year in years)


def classify_search_need(query: str, requested_mode: SearchMode = "auto") -> SearchDecision:
    """Classify whether a query needs live web context.

    The classifier is intentionally deterministic and lightweight. It can be
    replaced later by a model-based router without changing the chat route.
    """
    normalized = " ".join((query or "").split())
    mode: SearchMode = requested_mode if requested_mode in ("auto", "workspace", "web", "hybrid") else "auto"

    if mode == "workspace":
        return SearchDecision(
            requested_mode=mode,
            effective_mode=mode,
            needs_web=False,
            confidence=1.0,
            reasons=["workspace_mode_selected"],
        )

    if mode in ("web", "hybrid"):
        return SearchDecision(
            requested_mode=mode,
            effective_mode=mode,
            needs_web=True,
            confidence=1.0,
            reasons=[f"{mode}_mode_selected"],
        )

    reasons: list[str] = []
    if _CURRENT_TERMS.search(normalized):
        reasons.append("current_time_sensitive_terms")
    if _VOLATILE_TOPICS.search(normalized):
        reasons.append("volatile_topic")
    if _WEB_REFERENCES.search(normalized):
        reasons.append("explicit_web_or_sources_request")
    if _contains_current_year(normalized):
        reasons.append("recent_year_reference")

    document_only = bool(_DOCUMENT_ONLY.search(normalized))
    confidence = min(0.95, 0.35 + (0.2 * len(reasons))) if reasons else 0.0
    needs_web = bool(reasons) and not (document_only and len(reasons) == 1)

    return SearchDecision(
        requested_mode=mode,
        effective_mode="hybrid" if needs_web else "workspace",
        needs_web=needs_web,
        confidence=confidence if needs_web else 0.0,
        reasons=reasons or ["no_live_web_signal"],
    )
