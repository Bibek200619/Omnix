-- Migration: Enable pgvector and add embedding column to documents

-- 1) Enable the pgvector extension if not exists
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) Add embedding column to documents table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='documents' AND column_name='embedding'
  ) THEN
    ALTER TABLE documents ADD COLUMN embedding vector(384);
  END IF;
END$$;

-- 3) Create RPC function for semantic search
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
    AND 1 - (documents.embedding <=> query_embedding) > match_threshold
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
