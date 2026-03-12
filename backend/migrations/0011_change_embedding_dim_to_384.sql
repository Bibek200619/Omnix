-- Migration: change documents.embedding vector dimension to 384 for all-MiniLM-L6-v2
-- WARNING: Changing vector column dimension requires re-embedding existing vectors or truncation. Review before applying.

-- Example approach (Postgres + pgvector):
-- 1. Create a new temporary column with the new dimension
ALTER TABLE documents ADD COLUMN embedding_new vector(384);

-- 2. If you have existing embeddings with higher dim and want to preserve first 384 values (not recommended), you can copy a slice:
-- UPDATE documents SET embedding_new = embedding[1:384];

-- 3. Alternatively, leave embedding_new NULL and re-embed all documents using the local provider.

-- 4. After populating embedding_new, drop old column and rename
-- ALTER TABLE documents DROP COLUMN embedding;
-- ALTER TABLE documents RENAME COLUMN embedding_new TO embedding;

-- 5. Recreate index for embedding column (adjust index params as needed):
-- DROP INDEX IF EXISTS documents_embedding_idx;
-- CREATE INDEX documents_embedding_idx ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Note: This migration file provides a safe template. Do NOT run blindly in production. Prefer to create embedding_new and run re-embedding jobs to populate it before swapping.
