from __future__ import annotations

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0057_security_definer_role_grants.sql"
)
POLICY_HELPERS = (
    "public.omnix_has_workspace_conversation_access(uuid)",
    "public.omnix_can_read_workspace_channel(uuid)",
    "public.omnix_has_workspace_decision_access(uuid)",
    "public.omnix_has_workspace_task_access(uuid)",
)
SCHEMA_HEALTH = "public.omnix_workspace_schema_health()"


def test_security_definer_functions_have_explicit_role_grants() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    normalized = " ".join(sql.split())

    assert "begin;" in sql
    assert "commit;" in sql
    assert sql.count("set search_path = ''") == 5
    assert "from public, anon, authenticated, service_role;" in normalized

    policy_grant = normalized.split("grant execute on function", 1)[1].split(
        "to authenticated, service_role;",
        1,
    )[0]
    for signature in POLICY_HELPERS:
        assert f"alter function {signature}" in normalized
        assert signature in policy_grant

    assert f"alter function {SCHEMA_HEALTH}" in normalized
    assert SCHEMA_HEALTH not in policy_grant
    assert (
        "to authenticated, service_role; "
        f"grant execute on function {SCHEMA_HEALTH} to service_role;"
    ) in normalized
