from __future__ import annotations

from typing import Any
from ..services.chat_service import call_llm


async def run(context_engine, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
    query = "Create a helpful FAQ for this workspace: 10 short Q/A pairs based on the knowledge in the workspace."
    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt")
    assistant_text = await call_llm(prompt, context=None, temperature=0.1)

    return {
        "action": "faq",
        "markdown": assistant_text,
        "faq_text": assistant_text,
        "citations": assembled.get("sources", []),
    }
