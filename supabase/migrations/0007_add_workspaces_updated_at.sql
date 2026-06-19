-- Add updated_at to workspaces if missing
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill updated_at from created_at where possible
UPDATE workspaces SET updated_at = created_at WHERE updated_at IS NULL;
