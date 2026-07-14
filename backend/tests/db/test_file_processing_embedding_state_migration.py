from __future__ import annotations

from pathlib import Path


MIGRATION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "0047_file_processing_embedding_state.sql"


def test_file_processing_embedding_state_migration_extends_the_existing_constraint() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "DROP CONSTRAINT IF EXISTS files_processing_status_check" in sql
    assert "ADD CONSTRAINT files_processing_status_check" in sql
    for status in ("chunking", "embedding", "partially_searchable"):
        assert f"'{status}'" in sql
