from __future__ import annotations

from pathlib import Path


def test_file_content_hash_migration_adds_column_and_lookup_indexes() -> None:
    migration = Path("backend/migrations/0045_add_file_content_hash.sql").read_text(encoding="utf-8")

    assert "ALTER TABLE public.files" in migration
    assert "ADD COLUMN IF NOT EXISTS content_hash text" in migration
    assert "idx_files_workspace_content_hash" in migration
    assert "idx_files_personal_content_hash" in migration
