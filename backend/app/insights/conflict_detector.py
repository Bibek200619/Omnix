from typing import Any
from ..services.chat_service import call_llm
from ..services.citation_validation_service import finalize_generated_context_result


async def run(context_engine, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
    """Detect conflicting statements, inconsistent requirements, or policy conflicts."""
    query = "Find potential contradictions, inconsistent requirements, or policy conflicts across workspace documents. For each conflict provide: description, files involved, severity (low/medium/high), and recommendation."
    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt") or query

    instruction = (
        "\n\nReturn JSON: {conflicts: [{description, files: [str], severity, recommendation}]}, then a short markdown summary."
    )
    assistant_text = await call_llm(prompt + instruction, context=None, temperature=0.0)

    return finalize_generated_context_result({
        "action": "conflict_detection",
        "markdown": assistant_text,
        "structured_text": assistant_text,
        "citations": assembled.get("sources", []),
    })
