from __future__ import annotations

from pathlib import Path


MIGRATION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "0048_workspace_decision_evidence.sql"


def test_workspace_decision_evidence_migration_is_bounded_and_immutable() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "ADD COLUMN IF NOT EXISTS source_evidence jsonb" in sql
    assert "ALTER COLUMN source_evidence SET DEFAULT '[]'::jsonb" in sql
    assert "ALTER COLUMN source_evidence SET NOT NULL" in sql
    assert "workspace_decisions_source_evidence_check" in sql
    assert "jsonb_typeof(source_evidence) = 'array'" in sql
    assert "jsonb_array_length(source_evidence) <= 5" in sql
    assert "prevent_workspace_decision_source_evidence_mutation" in sql
    assert "workspace_decisions_source_evidence_immutable" in sql
