from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = REPO_ROOT / "migrations" / "0046_message_feedback.sql"
ALEMBIC_MIGRATION = REPO_ROOT / "alembic" / "versions" / "0046_message_feedback.py"


def test_message_feedback_sql_migration_defines_feedback_table() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS public.message_feedback" in sql
    assert "rating text NOT NULL" in sql
    assert "message_id uuid NOT NULL" in sql
    assert "UNIQUE (message_id, user_id)" in sql


def test_message_feedback_alembic_migration_is_present() -> None:
    migration = ALEMBIC_MIGRATION.read_text(encoding="utf-8")

    assert "revision = \"0046_message_feedback\"" in migration
    assert "down_revision = \"0045_existing_sql_baseline\"" in migration
    assert "message_feedback" in migration
