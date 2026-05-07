from __future__ import annotations

from typing import Any
from ..services.chat_service import call_llm
from typing import Any


async def run(context_engine, user_id: str, workspace_id: str | None = None, params: dict | None = None) -> dict[str, Any]:
    if params is None:
        params = {}

    if params.get("doc_a") and params.get("doc_b"):
        query = f"Compare document {params.get('doc_a')} with {params.get('doc_b')}: highlight differences, overlap, and recommendations."
    else:
        query = "Compare the main themes and any inconsistencies across workspace documents."

    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt")
    assistant_text = await call_llm(prompt, context=None, temperature=0.2)

    return {
        "action": "compare",
        "markdown": assistant_text,
        "citations": assembled.get("sources", []),
    }
