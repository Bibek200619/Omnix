from __future__ import annotations

import re
from pathlib import Path


BASELINE_MIGRATION = Path(__file__).resolve().parents[2] / "migrations" / "0029_schema_baseline_audit.sql"
GIN_INDEXES = (
    "idx_workspaces_intelligence_preferences",
    "idx_messages_metadata_gin",
    "idx_messages_payload_gin",
    "idx_files_metadata_gin",
    "idx_files_file_name_fts",
    "idx_documents_content_fts",
    "idx_documents_metadata_gin",
    "idx_artifacts_metadata_gin",
    "idx_workspace_intelligence_memory_structured_data",
)


def test_write_heavy_gin_indexes_have_pending_list_tuning() -> None:
    sql = BASELINE_MIGRATION.read_text(encoding="utf-8")

    for index_name in GIN_INDEXES:
        create_pattern = (
            rf"CREATE INDEX IF NOT EXISTS {re.escape(index_name)}\b"
            rf".*?WITH \(fastupdate = on, gin_pending_list_limit = 16384\);"
        )
        assert re.search(create_pattern, sql, re.DOTALL), f"{index_name} create statement is not tuned"
        assert (
            f"ALTER INDEX IF EXISTS public.{index_name} "
            "SET (fastupdate = on, gin_pending_list_limit = 16384);"
        ) in sql
