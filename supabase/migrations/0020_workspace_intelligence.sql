-- Migration: Workspace intelligence profiles and retrieval preferences.
-- Idempotent so existing Supabase projects can apply it safely.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='expertise_area'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN expertise_area text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='ai_specialization'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN ai_specialization text DEFAULT 'general';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='ai_instructions'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN ai_instructions text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='intelligence_preferences'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN intelligence_preferences jsonb DEFAULT '{}'::jsonb;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_workspaces_ai_specialization
ON workspaces(ai_specialization);

CREATE INDEX IF NOT EXISTS idx_workspaces_intelligence_preferences
ON workspaces USING gin (intelligence_preferences);
