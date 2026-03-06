-- Migration: Add workspaces table and workspace_id columns

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='workspaces') THEN
    CREATE TABLE workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      name text NOT NULL,
      description text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz
    );
  END IF;

  -- Add workspace_id to files
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='workspace_id') THEN
    ALTER TABLE files ADD COLUMN workspace_id uuid;
  END IF;

  -- Add workspace_id to documents
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='workspace_id') THEN
    ALTER TABLE documents ADD COLUMN workspace_id uuid;
  END IF;

  -- Add workspace_id to conversations
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='workspace_id') THEN
    ALTER TABLE conversations ADD COLUMN workspace_id uuid;
  END IF;

  -- Indexes
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_files_workspace_id') THEN
    CREATE INDEX idx_files_workspace_id ON files(workspace_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_documents_workspace_id') THEN
    CREATE INDEX idx_documents_workspace_id ON documents(workspace_id);
  END IF;
END$$;
