from typing import Any
from ..insights import workspace_summary, action_item_detector, topic_detection, conflict_detector
from ..context.engine import ContextEngine


async def run_insight_refresh(workspace_id: str, user_id: str | None = None) -> dict[str, Any]:
    engine = ContextEngine()
    uid = user_id or "system"
    summary = await workspace_summary.run(engine, uid, workspace_id)
    topics = await topic_detection.run(engine, uid, workspace_id)
    actions = await action_item_detector.run(engine, uid, workspace_id)
    conflicts = await conflict_detector.run(engine, uid, workspace_id)
    return {"summary": summary, "topics": topics, "actions": actions, "conflicts": conflicts}
