from __future__ import annotations

from pathlib import Path


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"


def read_frontend(relative_path: str) -> str:
    return (FRONTEND_ROOT / relative_path).read_text(encoding="utf-8")


def test_decision_graph_is_shared_by_tasks_and_decisions() -> None:
    graph = read_frontend("components/provenance/DecisionGraphSummary.tsx")
    task_card = read_frontend("components/tasks/TaskCard.tsx")
    decision_panel = read_frontend("components/decisions/DecisionContextPanel.tsx")

    assert "export type DecisionGraphNode" in graph
    assert 'aria-label="Decision traceability graph"' in graph
    assert '"task" | "decision" | "evidence" | "source"' in graph
    assert "DecisionGraphSummary" in task_card
    assert "taskDecisionGraphNodes" in task_card
    assert "DecisionGraphSummary" in decision_panel
    assert "decisionGraphNodes" in decision_panel


def test_source_health_console_surfaces_ingestion_recovery() -> None:
    console = read_frontend("components/files/SourceHealthConsole.tsx")
    files_page = read_frontend("app/(dashboard)/files/page.tsx")

    assert "data-source-health-console" in console
    assert "Ingestion console" in console
    assert "processing_job_id" in console
    assert "onRetryConnector" in console
    assert "SourceHealthConsole" in files_page


def test_product_maturity_controls_include_digest_and_audit_export() -> None:
    notification_settings = read_frontend("app/(dashboard)/settings/notifications/page.tsx")
    activity_feed = read_frontend("components/workspace/WorkspaceActivityFeed.tsx")

    assert "Digest controls" in notification_settings
    assert "omnix.notifications.digestCadence" in notification_settings
    assert "omnix.notifications.digestUnreadOnly" in notification_settings
    assert "Export activity JSON" in activity_feed
    assert "omnix-workspace-activity" in activity_feed
