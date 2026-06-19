-- Migration: Add artifacts table for persistent AI-generated knowledge

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'artifacts'
  ) THEN
    CREATE TABLE artifacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid,
      user_id uuid NOT NULL,
      title text NOT NULL,
      type text NOT NULL,
      content text NOT NULL,
      metadata jsonb DEFAULT '{}'::jsonb,
      pinned boolean DEFAULT false,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_artifacts_workspace_id') THEN
    CREATE INDEX idx_artifacts_workspace_id ON artifacts(workspace_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_artifacts_user_id') THEN
    CREATE INDEX idx_artifacts_user_id ON artifacts(user_id);
  END IF;
END$$;
