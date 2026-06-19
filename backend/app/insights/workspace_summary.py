from typing import Any
from ..services.chat_service import call_llm


async def run(context_engine, user_id: str, workspace_id: str | None = None) -> dict[str, Any]:
    """Generate a concise workspace summary: overview, key themes, doc stats, top findings."""
    query = "Produce a concise workspace overview: an executive summary (3-4 sentences), top 5 themes, document statistics (counts by type/size), and 3 short top findings or risks. Return a small JSON object and a markdown summary."
    assembled = await context_engine.assemble(query, user_id, workspace_id)
    prompt = assembled.get("prompt") or query

    # Instruct LLM to output JSON and a short markdown summary separated by a delimiter
    instruction = (
        "\n\nRespond with JSON only first, then a '---' line, then a short markdown summary. "
        "JSON schema: {overview: str, themes: [str], doc_stats: {total:int, by_type: dict}, top_findings: [str]}"
    )
    assistant_text = await call_llm(prompt + instruction, context=None, temperature=0.0)

    return {
        "action": "workspace_summary",
        "markdown": assistant_text,
        "structured_text": assistant_text,
        "citations": assembled.get("sources", []),
    }
