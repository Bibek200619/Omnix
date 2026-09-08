from __future__ import annotations

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0056_workspace_membership_rls_dependencies.sql"
)


def test_membership_reads_remain_scoped_for_authenticated_rls_dependencies() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "begin;" in sql
    assert "commit;" in sql
    assert "alter function public.omnix_has_workspace_task_access(uuid)" in sql
    assert "set search_path = ''" in sql
    assert (
        "revoke all privileges on table public.workspace_members from authenticated"
        in sql
    )
    assert "grant select on table public.workspace_members to authenticated" in sql
    assert (
        'drop policy if exists "scoped member visibility" on public.workspace_members'
    ) in sql
    assert 'create policy "scoped member visibility"' in sql
    assert "for select" in sql
    assert "to authenticated" in sql
    assert "(select public.omnix_has_workspace_task_access(workspace_id))" in sql
