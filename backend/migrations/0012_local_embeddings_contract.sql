-- Migration: enforce local all-MiniLM-L6-v2 embedding contract.
--
-- LocalEmbeddingProvider uses sentence-transformers/all-MiniLM-L6-v2, which
-- emits 384-dimensional vectors. If an older documents.embedding column exists
-- with a different pgvector dimension, preserve it as embedding_legacy and
-- create a fresh vector(384) column for incremental re-embedding.

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
DECLARE
  embedding_type text;
  legacy_exists boolean;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO embedding_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'documents'
    AND a.attname = 'embedding'
    AND NOT a.attisdropped;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'embedding_legacy'
  )
  INTO legacy_exists;

  IF embedding_type IS NULL THEN
    ALTER TABLE documents ADD COLUMN embedding vector(384);
    RAISE NOTICE 'Created documents.embedding as vector(384).';
  ELSIF embedding_type <> 'vector(384)' THEN
    IF NOT legacy_exists THEN
      ALTER TABLE documents RENAME COLUMN embedding TO embedding_legacy;
      RAISE NOTICE 'Renamed legacy documents.embedding (%) to embedding_legacy.', embedding_type;
    ELSE
      RAISE NOTICE 'Dropping incompatible documents.embedding (%) because embedding_legacy already exists.', embedding_type;
      ALTER TABLE documents DROP COLUMN embedding;
    END IF;

    ALTER TABLE documents ADD COLUMN embedding vector(384);
    RAISE NOTICE 'Created replacement documents.embedding as vector(384). Re-embed documents incrementally.';
  ELSE
    RAISE NOTICE 'documents.embedding already uses vector(384).';
  END IF;
END$$;

DROP INDEX IF EXISTS idx_documents_embedding;
DROP INDEX IF EXISTS idx_documents_embedding_gist;
DROP INDEX IF EXISTS documents_embedding_idx;

CREATE INDEX IF NOT EXISTS idx_documents_embedding_cosine
ON documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE OR REPLACE FUNCTION search_documents_vector(q float8[], p_top_k int, p_user uuid, p_workspace uuid)
RETURNS TABLE(id uuid, content text, file_id uuid, created_at timestamptz, distance double precision) AS $$
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
    (d.embedding <=> q::vector(384)) AS distance
  FROM documents d
  WHERE d.embedding IS NOT NULL
    AND (
      (p_workspace IS NOT NULL AND d.workspace_id = p_workspace)
      OR (p_workspace IS NULL AND d.user_id = p_user)
    )
  ORDER BY distance
  LIMIT p_top_k;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  filter_user_id uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    documents.id,
    documents.content,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE documents.user_id = filter_user_id
    AND documents.embedding IS NOT NULL
    AND 1 - (documents.embedding <=> query_embedding) > match_threshold
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION omnix_embedding_contract()
RETURNS TABLE(
  expected_dimension int,
  embedding_type text,
  embedding_ready boolean,
  legacy_column_exists boolean,
  workspace_column_exists boolean,
  embedded_rows bigint,
  missing_embedding_rows bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    384 AS expected_dimension,
    COALESCE((
      SELECT format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'documents'
        AND a.attname = 'embedding'
        AND NOT a.attisdropped
    ), 'missing') AS embedding_type,
    COALESCE((
      SELECT format_type(a.atttypid, a.atttypmod) = 'vector(384)'
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'documents'
        AND a.attname = 'embedding'
        AND NOT a.attisdropped
    ), false) AS embedding_ready,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'documents'
        AND column_name = 'embedding_legacy'
    ) AS legacy_column_exists,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'documents'
        AND column_name = 'workspace_id'
    ) AS workspace_column_exists,
    (SELECT count(*) FROM documents WHERE embedding IS NOT NULL) AS embedded_rows,
    (SELECT count(*) FROM documents WHERE embedding IS NULL) AS missing_embedding_rows;
END;
$$ LANGUAGE plpgsql STABLE;
