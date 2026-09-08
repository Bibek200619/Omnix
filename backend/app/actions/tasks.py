from __future__ import annotations

from typing import Any
from ..services.chat_service import call_llm
from ..services.citation_validation_service import finalize_generated_context_result


async def run(context_engine, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
    query = "Extract concrete action items from the workspace documents. Produce JSON list with title, description, assignee (if any), due (if any), priority."
    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt")
    assistant_text = await call_llm(prompt, context=None, temperature=0.1)

    return finalize_generated_context_result({
        "action": "extract_tasks",
        "markdown": assistant_text,
        "tasks_text": assistant_text,
        "citations": assembled.get("sources", []),
    })
