-- Migration: Workspace-aware pgvector match_documents RPC.
--
-- Keeps the public RPC name used by Supabase clients while adding optional
-- workspace scoping for collaborative retrieval. The last parameter has a
-- default so four-argument health checks continue to work.

DROP FUNCTION IF EXISTS public.match_documents(vector(384), double precision, integer, uuid);

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(384),
  match_threshold double precision,
  match_count integer,
  filter_user_id uuid,
  filter_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id,
    d.content,
    (1 - (d.embedding <=> query_embedding))::double precision AS similarity
  FROM public.documents d
  WHERE d.embedding IS NOT NULL
    AND (
      (filter_workspace_ids IS NOT NULL AND d.workspace_id = ANY(filter_workspace_ids))
      OR (filter_workspace_ids IS NULL AND d.user_id = filter_user_id AND d.workspace_id IS NULL)
    )
    AND (1 - (d.embedding <=> query_embedding)) > coalesce(match_threshold, -1)
  ORDER BY d.embedding <=> query_embedding
  LIMIT greatest(coalesce(match_count, 8), 1);
$$;
