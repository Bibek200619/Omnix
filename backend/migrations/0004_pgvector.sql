-- Migration: Add pgvector support and embedding column + search function

DO $$
BEGIN
  -- Enable pgvector extension if available
  BEGIN
    PERFORM 1 FROM pg_extension WHERE extname = 'vector';
  EXCEPTION WHEN undefined_table THEN
    -- If pg_extension not queryable, attempt to create extension
    BEGIN
      CREATE EXTENSION IF NOT EXISTS vector;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'pgvector extension not available or insufficient privileges. Skipping extension creation.';
    END;
  END;

  -- Add embedding column to documents
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='embedding') THEN
    ALTER TABLE documents ADD COLUMN embedding vector(384);
  END IF;

  -- Create index on embedding for fast ANN (ivfflat). This requires pgvector support.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_documents_embedding') THEN
      -- ivfflat index provides efficient approximate nearest neighbor search
      BEGIN
        CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding) WITH (lists = 100);
      EXCEPTION WHEN others THEN
        -- Fall back to a simple GIST index if ivfflat not permitted
        CREATE INDEX IF NOT EXISTS idx_documents_embedding_gist ON documents USING gist (embedding);
      END;
    END IF;
  END IF;

  -- Create a SQL function to perform embedding-based search via RPC
  -- Accepts a float8[] representing the query vector and returns top-k documents
  CREATE OR REPLACE FUNCTION search_documents_vector(q float8[], p_top_k int, p_user uuid, p_workspace uuid)
  RETURNS TABLE(id uuid, content text, file_id uuid, created_at timestamptz, distance double precision) AS $$
  BEGIN
    RETURN QUERY
    SELECT d.id, d.content, d.file_id, d.created_at, (d.embedding <-> q::vector) as distance
    FROM documents d
    WHERE d.user_id = p_user
      AND (p_workspace IS NULL OR d.workspace_id = p_workspace)
      AND d.embedding IS NOT NULL
    ORDER BY distance
    LIMIT p_top_k;
  END;
  $$ LANGUAGE plpgsql STABLE;

END$$;
