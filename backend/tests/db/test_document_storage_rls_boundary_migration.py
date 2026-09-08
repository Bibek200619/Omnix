from __future__ import annotations

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0051_document_storage_rls_boundary.sql"
)

HARDENING_MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0052_document_storage_rls_policy_hardening.sql"
)

RETRIEVAL_FUNCTIONS = (
    "search_documents_keyword(text, integer, uuid, uuid)",
    "search_documents_keyword(text, integer, uuid, uuid[])",
    "search_documents_vector(double precision[], integer, uuid, uuid)",
    "search_documents_vector(double precision[], integer, uuid, uuid[])",
    "search_documents_vector(vector, integer, uuid, uuid[])",
    "match_documents(vector, double precision, integer, uuid)",
    "match_documents(vector, double precision, integer, uuid, uuid[])",
)


def test_document_storage_rls_migration_replaces_drifted_public_policies() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    for table, singular in (("documents", "document"), ("files", "file")):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;" in sql
        assert f'DROP POLICY IF EXISTS "Scoped {singular.title()} Visibility" ON public.{table};' in sql
        assert f"DROP POLICY IF EXISTS {table}_own ON public.{table};" in sql
        assert f"REVOKE ALL ON TABLE public.{table} FROM PUBLIC;" in sql
        assert f"REVOKE ALL ON TABLE public.{table} FROM anon;" in sql
        assert f"REVOKE ALL ON TABLE public.{table} FROM authenticated;" in sql
        assert f"GRANT SELECT ON TABLE public.{table} TO authenticated;" in sql
        assert f"GRANT ALL ON TABLE public.{table} TO service_role;" in sql

    assert 'CREATE POLICY "Users can read their own private documents"' in sql
    assert 'CREATE POLICY "Users can read their own private files"' in sql
    assert "workspace_id IS NULL" in sql
    assert "auth.uid() = user_id" in sql
    assert 'CREATE POLICY "Workspace members can read workspace documents"' in sql
    assert 'CREATE POLICY "Workspace members can read workspace files"' in sql
    assert "workspace_id IS NOT NULL" in sql
    assert "public.omnix_has_workspace_task_access(workspace_id)" in sql


def test_document_storage_rls_migration_limits_retrieval_rpcs_to_service_role() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    for signature in RETRIEVAL_FUNCTIONS:
        assert f"'public.{signature}'" in sql

    assert "WHERE to_regprocedure(signature) IS NOT NULL" in sql
    assert "REVOKE ALL ON FUNCTION %s FROM PUBLIC" in sql
    assert "REVOKE ALL ON FUNCTION %s FROM anon" in sql
    assert "REVOKE ALL ON FUNCTION %s FROM authenticated" in sql
    assert "GRANT EXECUTE ON FUNCTION %s TO service_role" in sql
    assert "GRANT EXECUTE ON FUNCTION %s TO authenticated" not in sql


def test_document_storage_rls_hardening_revokes_helper_drift_and_uses_cached_auth() -> None:
    sql = HARDENING_MIGRATION.read_text(encoding="utf-8")
    helper = "public.omnix_has_workspace_task_access(uuid)"

    for role in ("PUBLIC", "anon", "authenticated", "service_role"):
        assert f"REVOKE ALL ON FUNCTION {helper} FROM {role};" in sql
    assert f"GRANT EXECUTE ON FUNCTION {helper} TO authenticated, service_role;" in sql
    assert "(select auth.uid()) = user_id" in sql
    assert "(select public.omnix_has_workspace_task_access(workspace_id))" in sql
