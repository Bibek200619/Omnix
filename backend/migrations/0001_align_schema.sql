-- Migration: Align DB schema with backend expectations (snake_case)
-- This migration is idempotent and safe to run multiple times.

-- 1) Conversations: ensure is_archived exists and is boolean
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='conversations' AND column_name='is_archived'
  ) THEN
    -- If an older 'archived' column exists, rename it.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='conversations' AND column_name='archived'
    ) THEN
      ALTER TABLE conversations RENAME COLUMN archived TO is_archived;
    ELSE
      ALTER TABLE conversations ADD COLUMN is_archived boolean DEFAULT FALSE;
    END IF;
  END IF;
END$$;

-- 2) Files: standardize to file_name and ensure expected columns exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='files' AND column_name='file_name'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='files' AND column_name='filename'
    ) THEN
      ALTER TABLE files RENAME COLUMN filename TO file_name;
    ELSE
      ALTER TABLE files ADD COLUMN file_name text;
    END IF;
  END IF;

  -- Rename content_type -> file_type if present, otherwise add file_type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='content_type'
  ) THEN
    ALTER TABLE files RENAME COLUMN content_type TO file_type;
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='file_type') THEN
    ALTER TABLE files ADD COLUMN file_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='size_bytes') THEN
    ALTER TABLE files ADD COLUMN size_bytes bigint;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='storage_path') THEN
    ALTER TABLE files ADD COLUMN storage_path text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='metadata') THEN
    ALTER TABLE files ADD COLUMN metadata jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='conversation_id') THEN
    ALTER TABLE files ADD COLUMN conversation_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='created_at') THEN
    ALTER TABLE files ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END$$;

-- 3) Messages: ensure conversation_id exists and standard columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='conversation_id') THEN
    ALTER TABLE messages ADD COLUMN conversation_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='status') THEN
    ALTER TABLE messages ADD COLUMN status text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='created_at') THEN
    ALTER TABLE messages ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END$$;

-- 4) Documents: ensure columns for ingestion
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='documents') THEN
    CREATE TABLE documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      content text NOT NULL,
      file_id uuid,
      created_at timestamptz DEFAULT now()
    );
  ELSE
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='content') THEN
      ALTER TABLE documents ADD COLUMN content text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='file_id') THEN
      ALTER TABLE documents ADD COLUMN file_id uuid;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='created_at') THEN
      ALTER TABLE documents ADD COLUMN created_at timestamptz DEFAULT now();
    END IF;
  END IF;
END$$;

-- 5) Foreign keys: link user_id to auth.users and file->conversation if possible
DO $$
BEGIN
  -- Add FK for files.user_id -> auth.users(id) if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'files_user_id_fkey' AND t.relname = 'files'
  ) THEN
    BEGIN
      ALTER TABLE files
      ADD CONSTRAINT files_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      -- auth.users not present in the same schema or permission issues; skip
      RAISE NOTICE 'Skipping auth.users FK creation - auth.users not available.';
    END;
  END IF;

  -- Add FK for documents.user_id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'documents_user_id_fkey' AND t.relname = 'documents'
  ) THEN
    BEGIN
      ALTER TABLE documents
      ADD CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping auth.users FK creation for documents - auth.users not available.';
    END;
  END IF;

  -- Optionally add FK for files.conversation_id -> conversations.id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='conversation_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE c.conname = 'files_conversation_id_fkey' AND t.relname = 'files'
    ) THEN
      BEGIN
        ALTER TABLE files
        ADD CONSTRAINT files_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
      EXCEPTION WHEN undefined_table OR undefined_object THEN
        RAISE NOTICE 'Skipping conversation FK creation - conversations table not available.';
      END;
    END IF;
  END IF;
END$$;

-- 6) Indexes: add common indexes to speed up tenant-scoped reads
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_files_user_id') THEN
    CREATE INDEX idx_files_user_id ON files(user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_documents_user_id') THEN
    CREATE INDEX idx_documents_user_id ON documents(user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_messages_conversation_id') THEN
    CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
  END IF;
END$$;

-- Migration complete
