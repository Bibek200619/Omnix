from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set
from enum import Enum


class ContextSourceType(str, Enum):
    RETRIEVAL = "retrieval"
    MEMORY = "memory"
    WORKSPACE = "workspace"
    ACTION = "action"
    AUTOMATION = "automation"
    SYSTEM = "system"


@dataclass
class Citation:
    source_id: str
    source_type: ContextSourceType
    content: str
    file_id: Optional[str] = None
    file_name: str = "Unknown File"
    metadata: Dict[str, Any] = field(default_factory=dict)
    score: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_type": self.source_type.value,
            "content": self.content[:200] + "..." if len(self.content) > 200 else self.content,
            "file_id": self.file_id,
            "file_name": self.file_name,
            "score": self.score,
        }


@dataclass
class ContextPayload:
    query: str
    workspace_id: Optional[str] = None
    conversation_id: Optional[str] = None
    user_id: Optional[str] = None
    action_context: Optional[Dict[str, Any]] = None
    automation_context: Optional[Dict[str, Any]] = None


@dataclass
class AssembledContext:
    prompt: str
    citations: List[Citation] = field(default_factory=list)
    diagnostics: Dict[str, Any] = field(default_factory=dict)
    token_usage: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "prompt": self.prompt,
            "citations": [c.to_dict() for c in self.citations],
            "diagnostics": self.diagnostics,
            "token_usage": self.token_usage,
        }
