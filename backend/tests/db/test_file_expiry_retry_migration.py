from __future__ import annotations

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "20260728111010_resume_pending_file_expiry_jobs.sql"
)


def test_pending_expiry_is_requeued_only_after_active_attempt_finishes() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    normalized = " ".join(sql.split())

    assert "begin;" in sql
    assert "commit;" in sql
    assert "create or replace function public.omnix_enqueue_expired_file_jobs" in sql
    assert "f.lifecycle_status in ('active', 'retention_pending')" in normalized
    assert "active_job.type = 'expire_file'" in normalized
    assert "active_job.status in ('queued', 'processing')" in normalized
    assert "active_job.payload ->> 'file_id' = f.id::text" in normalized
    assert "for update skip locked" in normalized
    assert "set lifecycle_status = 'retention_pending'" in normalized
    assert "on conflict do nothing" in normalized
    assert "security invoker" in sql
    assert "set search_path = ''" in sql
    assert (
        "grant execute on function public.omnix_enqueue_expired_file_jobs(integer) "
        "to service_role"
    ) in normalized
