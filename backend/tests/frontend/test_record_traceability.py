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
    decision_modal = read_frontend("components/decisions/CreateDecisionModal.tsx")
    decision_from_message_modal = read_frontend("components/conversations/DecisionFromMessageModal.tsx")
    files_page = read_frontend("app/(dashboard)/files/page.tsx")
    initiative_panel = read_frontend("components/initiatives/InitiativeDetailPanel.tsx")
    workspace_types = read_frontend("lib/workspace-types.ts")

    assert "task.linked_context.map" in task_card
    assert "task.linked_decisions.map" in task_card
    assert "task.initiative_id" in task_card
    assert "decision.source_message_id" in decision_panel
    assert "decision.source_type === \"document\"" in decision_panel
    assert "Source document" in decision_panel
    assert "decision.linked_tasks.map" in decision_panel
    assert "decision.initiative" in decision_panel
    assert "source_type: initialValues?.source_type" in decision_modal
    assert '"/candidates/accept"' in decision_modal
    assert "source_evidence: initialValues?.source_evidence" in decision_modal
    assert "source_type: source.candidate.source_type" in decision_from_message_modal
    assert "source_evidence: source.candidate.supporting_evidence" in decision_from_message_modal
    assert "/decisions/candidates/accept" in decision_from_message_modal
    assert "source_type: candidate.source_type" in files_page
    assert "source_evidence: candidate.supporting_evidence" in files_page
    assert "candidate_id: candidate.id" in files_page
    assert "decision.source_evidence" in decision_panel
    assert "DecisionEvidence" in workspace_types
    assert "selected.linked_resources.map" in initiative_panel
    assert "selected.linked_channels.map" in initiative_panel
    assert "selected.linked_tasks.map" in initiative_panel
    assert "WorkspaceInitiativeProvenanceSummary" in workspace_types
    assert "selected.provenance_summary?.summary" in initiative_panel
    assert "selected.provenance_summary?.needs_repair" in initiative_panel
    assert "Missing source context" in initiative_panel
