from __future__ import annotations

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0055_workspace_collaboration_backend_only.sql"
)


def test_workspace_collaboration_tables_are_backend_only() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "begin;" in sql
    assert "commit;" in sql
    assert sql.count("revoke all privileges on table") == 3
    assert sql.count("public.workspace_invites") == 4
    assert sql.count("public.workspace_members") == 4
    assert "from public;" in sql
    assert "from anon;" in sql
    assert "from authenticated;" in sql
    assert "grant all privileges on table" in sql
    assert "to service_role;" in sql
