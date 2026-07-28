from __future__ import annotations

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "20260728105949_durable_file_lifecycle.sql"
)


def test_file_lifecycle_migration_is_transactional_private_and_retryable() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    normalized = " ".join(sql.split())

    assert "begin;" in sql
    assert "commit;" in sql
    assert "create table if not exists public.file_versions" in sql
    assert "add column if not exists retention_expires_at timestamptz" in normalized
    assert (
        "add column if not exists lifecycle_status text not null default 'active'"
        in normalized
    )
    assert "alter table public.file_versions enable row level security" in normalized
    for role in ("public", "anon", "authenticated"):
        assert f"revoke all on table public.file_versions from {role}" in normalized
        assert f"revoke all on table public.jobs from {role}" in normalized
    assert "grant all on table public.file_versions to service_role" in normalized
    assert "grant all on table public.jobs to service_role" in normalized

    assert "file_versions_immutable_identity" in sql
    assert "file version identity is immutable" in sql
    assert "files_track_storage_lifecycle" in sql
    assert (
        "after insert or update of storage_path or delete on public.files" in normalized
    )
    assert "'storage_replaced'" in sql
    assert "'file_deleted'" in sql
    assert "'file_version_id', p_file_version_id" in normalized
    assert "'cleanup_key', cleanup_key" in normalized
    assert "jsonb_build_object('storage_path'" not in normalized

    assert "create or replace function public.omnix_enqueue_expired_file_jobs" in sql
    assert "security invoker" in sql
    assert "for update skip locked" in normalized
    assert "idx_jobs_active_file_expiry" in sql
    assert (
        "grant execute on function public.omnix_enqueue_expired_file_jobs(integer) "
        "to service_role"
    ) in normalized

    assert "create or replace function public.omnix_enqueue_orphan_file_cleanup" in sql
    assert "from public.files where storage_path = normalized_path" in normalized
    assert "lifecycle_status = 'active'" in normalized
    assert "pg_catalog.pg_advisory_xact_lock" in normalized
    assert "'orphan_reconciliation'" in sql
    assert (
        "grant execute on function public.omnix_enqueue_orphan_file_cleanup(text, text) "
        "to service_role"
    ) in normalized


def test_file_version_history_survives_source_cascades_without_a_foreign_key() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    table_body = sql.split("create table if not exists public.file_versions", 1)[
        1
    ].split(
        "alter table public.file_versions enable row level security",
        1,
    )[0]

    assert "references public.files" not in table_body
    assert "original_user_id uuid" in table_body
    assert "original_workspace_id uuid" in table_body
    assert "unique (file_id, version_number)" in table_body
    assert "idx_file_versions_one_active_per_file" in sql
