from pathlib import Path


MIGRATIONS = Path(__file__).parents[2] / "supabase" / "migrations"


def test_workspace_activity_rls_is_membership_scoped_and_backend_written() -> None:
    policy = (MIGRATIONS / "20260908195203_restrict_workspace_activity_rls.sql").read_text()
    grants = (MIGRATIONS / "20260908195253_restrict_workspace_activity_table_grants.sql").read_text()

    assert 'DROP POLICY IF EXISTS "Scoped Activity Visibility"' in policy
    assert 'TO authenticated' in policy
    assert "omnix_has_workspace_task_access(workspace_id)" in policy
    assert "REVOKE ALL PRIVILEGES ON TABLE public.workspace_activity_events FROM anon" in policy
    assert "DROP POLICY IF EXISTS \"Workspace members can create activity events\"" in policy
    assert "REVOKE ALL PRIVILEGES ON TABLE public.workspace_activity_events FROM authenticated" in grants
    assert "GRANT SELECT ON TABLE public.workspace_activity_events TO authenticated" in grants
