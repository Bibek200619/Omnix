from __future__ import annotations

from pathlib import Path


MIGRATION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "0043_workspace_search_fulltext.sql"
HARDENING_MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0044_workspace_search_membership_boundary.sql"
)
SAFE_RESULTS_MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0049_workspace_search_safe_results.sql"
)
ROLE_GRANTS_MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0050_workspace_search_rpc_role_grants.sql"
)


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


def test_workspace_search_ranked_rpc_requires_workspace_membership_boundary() -> None:
    sql = HARDENING_MIGRATION.read_text(encoding="utf-8")

    assert "CREATE OR REPLACE FUNCTION public.search_workspace_ranked" in sql
    assert "workspace_access AS" in sql
    assert "(select auth.role()) = 'service_role'" in sql
    assert "public.omnix_has_workspace_task_access(p_workspace_id)" in sql
    assert "FROM ranked, workspace_access" in sql
    assert "WHERE workspace_access.allowed" in sql
    assert (
        "REVOKE ALL ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) FROM PUBLIC;"
        in sql
    )
    assert (
        "GRANT EXECUTE ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) TO authenticated;"
        in sql
    )


def test_workspace_search_safe_results_migration_excludes_operational_jobs() -> None:
    sql = SAFE_RESULTS_MIGRATION.read_text(encoding="utf-8")

    assert "CREATE OR REPLACE FUNCTION public.search_workspace_ranked" in sql
    assert "workspace_access AS" in sql
    assert "public.omnix_has_workspace_task_access(p_workspace_id)" in sql
    assert "FROM public.jobs" not in sql
    assert "payload->>'workspace_id'" not in sql
    assert "coalesce(j.error" not in sql
    assert "FROM ranked, workspace_access" in sql
    assert "WHERE workspace_access.allowed" in sql
    assert (
        "REVOKE ALL ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) FROM PUBLIC;"
        in sql
    )


def test_workspace_search_role_grants_explicitly_revoke_anon_access() -> None:
    sql = ROLE_GRANTS_MIGRATION.read_text(encoding="utf-8")

    assert "REVOKE ALL ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) FROM PUBLIC;" in sql
    assert "REVOKE ALL ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) FROM anon;" in sql
    assert "GRANT EXECUTE ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) TO authenticated;" in sql
    assert "GRANT EXECUTE ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) TO service_role;" in sql
