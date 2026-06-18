-- Migration: Persist assistant source metadata for hybrid workspace + web research.
-- Idempotent and safe to run repeatedly.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='messages' AND column_name='metadata'
  ) THEN
    ALTER TABLE messages ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_messages_metadata_sources
ON messages USING gin (metadata);
