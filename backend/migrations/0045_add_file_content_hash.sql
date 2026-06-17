-- Migration: Store upload content hashes for file deduplication.

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_files_workspace_content_hash
  ON public.files(workspace_id, content_hash)
  WHERE content_hash IS NOT NULL AND workspace_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_files_personal_content_hash
  ON public.files(user_id, content_hash)
  WHERE content_hash IS NOT NULL AND workspace_id IS NULL;
