from typing import Any
from ..services.chat_service import call_llm


async def run(context_engine, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
    """Detect dominant topics and recurring concepts in the workspace."""
    query = "Detect dominant themes and recurring concepts in this workspace. Return top 8 topics with brief descriptions and example snippets or file references."
    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt") or query

    instruction = (
        "\n\nReturn JSON: {topics: [{name: str, weight: float, description: str, examples: [str]}]}\nThen a short markdown list of topics."
    )
    assistant_text = await call_llm(prompt + instruction, context=None, temperature=0.0)

    return {
        "action": "topic_detection",
        "markdown": assistant_text,
        "structured_text": assistant_text,
        "citations": assembled.get("sources", []),
    }
