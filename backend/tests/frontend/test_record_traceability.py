from __future__ import annotations

from pathlib import Path


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"


def read_frontend(relative_path: str) -> str:
    return (FRONTEND_ROOT / relative_path).read_text(encoding="utf-8")


def test_traceability_panel_is_shared_across_core_records() -> None:
    component = read_frontend("components/provenance/RecordTraceabilityPanel.tsx")
    task_card = read_frontend("components/tasks/TaskCard.tsx")
    decision_panel = read_frontend("components/decisions/DecisionContextPanel.tsx")
    initiative_panel = read_frontend("components/initiatives/InitiativeDetailPanel.tsx")

    assert "export function RecordTraceabilityPanel" in component
    assert "RecordTraceabilityPanel" in task_card
    assert "RecordTraceabilityPanel" in decision_panel
    assert "RecordTraceabilityPanel" in initiative_panel


def test_traceability_links_reuse_existing_provenance_fields() -> None:
    task_card = read_frontend("components/tasks/TaskCard.tsx")
    decision_panel = read_frontend("components/decisions/DecisionContextPanel.tsx")
    initiative_panel = read_frontend("components/initiatives/InitiativeDetailPanel.tsx")

    assert "task.linked_context.map" in task_card
    assert "task.linked_decisions.map" in task_card
    assert "task.initiative_id" in task_card
    assert "decision.source_message_id" in decision_panel
    assert "decision.linked_tasks.map" in decision_panel
    assert "decision.initiative" in decision_panel
    assert "selected.linked_resources.map" in initiative_panel
    assert "selected.linked_channels.map" in initiative_panel
    assert "selected.linked_tasks.map" in initiative_panel
