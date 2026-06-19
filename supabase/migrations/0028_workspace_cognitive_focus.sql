-- Migration: Workspace cognitive focus routing.
-- Adds a canonical workspace_focus column while preserving ai_specialization as a legacy mirror.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='workspace_focus'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN workspace_focus text DEFAULT 'general';
  END IF;
END$$;

UPDATE workspaces
SET workspace_focus = CASE
  WHEN lower(coalesce(workspace_focus, ai_specialization, 'general')) IN ('engineering', 'coding', 'code', 'dev', 'development', 'technical') THEN 'engineering'
  WHEN lower(coalesce(workspace_focus, ai_specialization, 'general')) = 'design' THEN 'design'
  WHEN lower(coalesce(workspace_focus, ai_specialization, 'general')) IN ('research', 'analytics', 'analysis', 'data') THEN 'research'
  WHEN lower(coalesce(workspace_focus, ai_specialization, 'general')) IN ('strategy', 'product', 'planning') THEN 'strategy'
  ELSE 'general'
END
WHERE workspace_focus IS NULL
   OR workspace_focus NOT IN ('general', 'engineering', 'design', 'research', 'strategy');

UPDATE workspaces
SET ai_specialization = workspace_focus
WHERE ai_specialization IS NULL
   OR ai_specialization NOT IN ('general', 'engineering', 'design', 'research', 'strategy')
   OR ai_specialization <> workspace_focus;

CREATE INDEX IF NOT EXISTS idx_workspaces_workspace_focus
ON workspaces(workspace_focus);
