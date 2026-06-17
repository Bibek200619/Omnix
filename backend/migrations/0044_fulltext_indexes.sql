-- Migration: Full-text indexes for keyword search.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction. This migration is
-- intentionally limited to index creation and should be applied by the normal
-- forward migration runner without wrapping it in BEGIN/COMMIT.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_channel_messages_content_fts
  ON public.workspace_channel_messages USING gin(to_tsvector('english', coalesce(content, '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_fts_english
  ON public.documents USING gin(to_tsvector('english', coalesce(content, '')));
