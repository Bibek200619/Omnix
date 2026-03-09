from __future__ import annotations

from typing import Any
from ..services.chat_service import call_llm
from typing import Any


async def run(context_engine, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
    """Summarize workspace using unified ContextEngine."""
    query = "Summarize the current workspace: provide key points, recent changes, important files, and short recommendations."
    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt")
    assistant_text = await call_llm(prompt, context=None, temperature=0.15)

    citations = assembled.get("sources", [])

    return {
        "action": "summarize",
        "markdown": assistant_text,
        "citations": citations,
        "artifacts": [],
    }
