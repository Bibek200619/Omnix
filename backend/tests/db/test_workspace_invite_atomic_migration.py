from __future__ import annotations

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0054_workspace_invite_atomic_acceptance.sql"
)


def test_invite_acceptance_migration_is_atomic_and_service_role_only() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "begin;" in sql
    assert "commit;" in sql
    assert "create unique index if not exists uq_workspace_members" in sql
    assert "create or replace function public.accept_workspace_invite_atomic" in sql
    assert "security invoker" in sql
    assert "set search_path = ''" in sql
    assert "for update" in sql
    assert "lower(btrim(invite.email)) = lower(btrim(p_email))" in sql
    assert "btrim(coalesce(invite_record.role, ''))" in sql
    assert "insert into public.workspace_members" in sql
    assert "on conflict (workspace_id, user_id) do nothing" in sql
    assert "update public.workspace_invites" in sql
    assert "invite.status = 'pending'" in sql
    assert "raise exception 'workspace invite transition lost'" in sql
    assert (
        "revoke all on function public.accept_workspace_invite_atomic"
        "(uuid, uuid, text) from public"
    ) in sql
    assert (
        "revoke all on function public.accept_workspace_invite_atomic"
        "(uuid, uuid, text) from anon"
    ) in sql
    assert (
        "revoke all on function public.accept_workspace_invite_atomic"
        "(uuid, uuid, text) from authenticated"
    ) in sql
    assert (
        "revoke all on function public.accept_workspace_invite_atomic"
        "(uuid, uuid, text) from service_role"
    ) in sql
    assert (
        "grant execute on function public.accept_workspace_invite_atomic"
        "(uuid, uuid, text) to service_role"
    ) in sql
