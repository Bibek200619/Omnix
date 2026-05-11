from __future__ import annotations

from typing import Any
from ..services.chat_service import call_llm


async def run(context_engine, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
    query = "Generate concise meeting-style notes capturing key points, decisions, and next steps from workspace documents."
    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt")
    assistant_text = await call_llm(prompt, context=None, temperature=0.12)

    return {
        "action": "notes",
        "markdown": assistant_text,
        "citations": assembled.get("sources", []),
    }
