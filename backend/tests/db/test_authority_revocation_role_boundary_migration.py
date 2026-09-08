from __future__ import annotations

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0058_authority_revocation_role_boundary.sql"
)


def test_authority_revocations_are_backend_published_and_user_readable() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    normalized = " ".join(sql.split())

    assert "begin;" in sql
    assert "commit;" in sql
    assert (
        "revoke all privileges on table public.authority_revocations "
        "from public, anon, authenticated, service_role;"
    ) in normalized
    assert (
        "grant select on table public.authority_revocations to authenticated;"
        in normalized
    )
    assert (
        "grant select, insert on table public.authority_revocations to service_role;"
    ) in normalized
    assert (
        'drop policy if exists "service role can insert authority revocations" '
        "on public.authority_revocations;"
    ) in normalized
    assert 'create policy "users can view their own authority revocations"' in sql
    assert "for select" in sql
    assert "to authenticated" in sql
    assert "using ((select auth.uid()) = user_id)" in sql
    assert "with check (true)" not in sql
