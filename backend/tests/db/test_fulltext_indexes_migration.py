from __future__ import annotations

from pathlib import Path


def test_fulltext_indexes_migration_adds_concurrent_english_gin_indexes() -> None:
    migration = Path("backend/migrations/0044_fulltext_indexes.sql").read_text(encoding="utf-8")

    assert "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_channel_messages_content_fts" in migration
    assert "ON public.workspace_channel_messages USING gin" in migration
    assert "to_tsvector('english', coalesce(content, ''))" in migration
    assert "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_fts_english" in migration
    assert "ON public.documents USING gin" in migration
