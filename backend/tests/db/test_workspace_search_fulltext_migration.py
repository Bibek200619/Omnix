from __future__ import annotations

from pathlib import Path


MIGRATION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "0043_workspace_search_fulltext.sql"


def test_workspace_search_fulltext_migration_defines_ranked_rpc_and_indexes() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "CREATE OR REPLACE FUNCTION public.search_workspace_ranked" in sql
    assert "websearch_to_tsquery('simple', coalesce(p_query, ''))" in sql
    assert "WHERE j.payload->>'workspace_id' = p_workspace_id::text" in sql

    for index_name in (
        "idx_workspace_search_tasks_fts",
        "idx_workspace_search_initiatives_fts",
        "idx_workspace_search_decisions_fts",
        "idx_workspace_search_files_fts",
        "idx_workspace_search_documents_fts",
        "idx_workspace_search_connectors_fts",
        "idx_workspace_search_automations_fts",
        "idx_workspace_search_activity_fts",
        "idx_workspace_search_jobs_fts",
    ):
        assert f"CREATE INDEX IF NOT EXISTS {index_name}" in sql
        assert "WITH (fastupdate = on, gin_pending_list_limit = 16384);" in sql

