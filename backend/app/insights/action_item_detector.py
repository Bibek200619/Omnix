from typing import Any
from ..services.chat_service import call_llm
from ..services.citation_validation_service import finalize_generated_context_result


async def run(context_engine, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
    """Detect actionable items: tasks, deadlines, assignees, TODOs."""
    query = "Extract actionable items across workspace docs: tasks, owners, deadlines, confidence. Return JSON list with title, description, assignee, due, confidence (0-1)."
    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt") or query

    instruction = (
        "\n\nReturn JSON array of items. Also include a short markdown summary of top 5 action items."
    )
    assistant_text = await call_llm(prompt + instruction, context=None, temperature=0.1)

    return finalize_generated_context_result({
        "action": "action_item_detection",
        "markdown": assistant_text,
        "structured_text": assistant_text,
        "citations": assembled.get("sources", []),
    })
