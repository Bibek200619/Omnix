from __future__ import annotations

from pathlib import Path


MIGRATION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "0046_decision_source_references.sql"


def test_decision_source_reference_migration_adds_generic_source_contract() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "ADD COLUMN IF NOT EXISTS source_type text" in sql
    assert "ADD COLUMN IF NOT EXISTS source_id text" in sql
    assert "workspace_decisions_source_reference_check" in sql
    assert "source_type IN ('conversation', 'conversation_message', 'document')" in sql
    assert "idx_workspace_decisions_source_reference" in sql
    assert "WHERE source_type IS NOT NULL" in sql
