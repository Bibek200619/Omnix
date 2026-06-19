-- Migration: Federated Retrieval Support
-- Updates RPCs to support searching across multiple workspaces (hierarchy-aware scoping).

-- 1. Vector Search Update
CREATE OR REPLACE FUNCTION search_documents_vector(
  q float8[], 
  p_top_k int, 
  p_user uuid, 
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(id uuid, content text, file_id uuid, created_at timestamptz, workspace_id uuid, distance double precision) AS $$
BEGIN
  IF array_length(q, 1) IS DISTINCT FROM 384 THEN
    RAISE EXCEPTION 'query embedding dimension mismatch: expected 384, got %', COALESCE(array_length(q, 1), 0);
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.file_id,
    d.created_at,
    d.workspace_id,
    (d.embedding <=> q::vector(384)) AS distance
  FROM documents d
  WHERE d.embedding IS NOT NULL
    AND (
      (p_workspace_ids IS NOT NULL AND d.workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_ids IS NULL AND d.user_id = p_user AND d.workspace_id IS NULL)
    )
  ORDER BY distance
  LIMIT GREATEST(1, p_top_k);
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. Keyword Search Update
CREATE OR REPLACE FUNCTION search_documents_keyword(
  q text, 
  p_top_k int, 
  p_user uuid, 
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  content text,
  file_id uuid,
  created_at timestamptz,
  workspace_id uuid,
  user_id uuid,
  rank double precision,
  file_name text,
  file_metadata jsonb
) AS $$
DECLARE
  normalized_query text := lower(trim(coalesce(q, '')));
  text_query tsquery := plainto_tsquery('simple', coalesce(q, ''));
BEGIN
  IF normalized_query = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT
      d.id,
      d.content,
      d.file_id,
      d.created_at,
      d.workspace_id,
      d.user_id,
      f.file_name,
      f.metadata AS file_metadata,
      (
        setweight(to_tsvector('simple', coalesce(d.content, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(f.file_name, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(f.metadata::text, '')), 'C')
      ) AS search_vector
    FROM documents d
    LEFT JOIN files f
      ON f.id = d.file_id
    WHERE
      (p_workspace_ids IS NOT NULL AND d.workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_ids IS NULL AND d.user_id = p_user AND d.workspace_id IS NULL)
  ),
  ranked AS (
    SELECT
      scoped.id,
      scoped.content,
      scoped.file_id,
      scoped.created_at,
      scoped.workspace_id,
      scoped.user_id,
      scoped.file_name,
      scoped.file_metadata,
      (
        ts_rank(scoped.search_vector, text_query)
        + CASE WHEN lower(coalesce(scoped.content, '')) LIKE '%' || normalized_query || '%' THEN 0.30 ELSE 0 END
        + CASE WHEN lower(coalesce(scoped.file_name, '')) = normalized_query THEN 0.60 ELSE 0 END
        + CASE WHEN lower(coalesce(scoped.file_name, '')) LIKE '%' || normalized_query || '%' THEN 0.35 ELSE 0 END
        + CASE WHEN lower(coalesce(scoped.file_metadata::text, '')) LIKE '%' || normalized_query || '%' THEN 0.15 ELSE 0 END
      )::double precision AS rank
    FROM scoped
    WHERE
      scoped.search_vector @@ text_query
      OR lower(coalesce(scoped.content, '')) LIKE '%' || normalized_query || '%'
      OR lower(coalesce(scoped.file_name, '')) LIKE '%' || normalized_query || '%'
      OR lower(coalesce(scoped.file_metadata::text, '')) LIKE '%' || normalized_query || '%'
  )
  SELECT
    ranked.id,
    ranked.content,
    ranked.file_id,
    ranked.created_at,
    ranked.workspace_id,
    ranked.user_id,
    ranked.rank,
    coalesce(ranked.file_name, 'Unknown File') AS file_name,
    ranked.file_metadata
  FROM ranked
  WHERE ranked.rank > 0
  ORDER BY ranked.rank DESC, ranked.created_at DESC NULLS LAST
  LIMIT GREATEST(1, p_top_k);
END;
$$ LANGUAGE plpgsql STABLE;
