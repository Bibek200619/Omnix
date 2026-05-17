-- Migration: collaborative workspace memberships, invites, and shared retrieval.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'workspace_members'
  ) THEN
    CREATE TABLE workspace_members (
      workspace_id uuid NOT NULL,
      user_id uuid NOT NULL,
      role text NOT NULL DEFAULT 'member',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id),
      CONSTRAINT workspace_members_role_check CHECK (role IN ('owner', 'member'))
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'workspace_invites'
  ) THEN
    CREATE TABLE workspace_invites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL,
      email text NOT NULL,
      role text NOT NULL DEFAULT 'member',
      status text NOT NULL DEFAULT 'pending',
      invited_by uuid NOT NULL,
      accepted_by_user_id uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      accepted_at timestamptz,
      CONSTRAINT workspace_invites_role_check CHECK (role IN ('member')),
      CONSTRAINT workspace_invites_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'))
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_user_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping workspaces.user_id FK creation - auth.users not available.';
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_workspace_id_fkey'
  ) THEN
    ALTER TABLE workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_user_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE workspace_members
      ADD CONSTRAINT workspace_members_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping workspace_members.user_id FK creation - auth.users not available.';
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_workspace_id_fkey'
  ) THEN
    ALTER TABLE workspace_invites
    ADD CONSTRAINT workspace_invites_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_invited_by_fkey'
  ) THEN
    BEGIN
      ALTER TABLE workspace_invites
      ADD CONSTRAINT workspace_invites_invited_by_fkey
      FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping workspace_invites.invited_by FK creation - auth.users not available.';
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_accepted_by_user_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE workspace_invites
      ADD CONSTRAINT workspace_invites_accepted_by_user_id_fkey
      FOREIGN KEY (accepted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping workspace_invites.accepted_by_user_id FK creation - auth.users not available.';
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_workspace_id_fkey'
  ) THEN
    ALTER TABLE files
    ADD CONSTRAINT files_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_workspace_id_fkey'
  ) THEN
    ALTER TABLE documents
    ADD CONSTRAINT documents_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_workspace_id_fkey'
  ) THEN
    ALTER TABLE conversations
    ADD CONSTRAINT conversations_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
  END IF;
END$$;

INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
SELECT
  w.id,
  w.user_id,
  'owner',
  COALESCE(w.created_at, now()),
  COALESCE(w.updated_at, w.created_at, now())
FROM workspaces w
ON CONFLICT (workspace_id, user_id)
DO UPDATE SET
  role = 'owner',
  updated_at = EXCLUDED.updated_at;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_workspace_members_user_id') THEN
    CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_workspace_members_workspace_role') THEN
    CREATE INDEX idx_workspace_members_workspace_role ON workspace_members(workspace_id, role);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_workspace_invites_workspace_id') THEN
    CREATE INDEX idx_workspace_invites_workspace_id ON workspace_invites(workspace_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_workspace_invites_email') THEN
    CREATE INDEX idx_workspace_invites_email ON workspace_invites(email);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ux_workspace_invites_pending_email') THEN
    CREATE UNIQUE INDEX ux_workspace_invites_pending_email
      ON workspace_invites(workspace_id, lower(email))
      WHERE status = 'pending';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_conversations_workspace_id') THEN
    CREATE INDEX idx_conversations_workspace_id ON conversations(workspace_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_documents_workspace_id_created_at') THEN
    CREATE INDEX idx_documents_workspace_id_created_at ON documents(workspace_id, created_at);
  END IF;
END$$;

CREATE OR REPLACE FUNCTION search_documents_vector(q float8[], p_top_k int, p_user uuid, p_workspace uuid)
RETURNS TABLE(id uuid, content text, file_id uuid, created_at timestamptz, distance double precision) AS $$
BEGIN
  RETURN QUERY
  SELECT d.id, d.content, d.file_id, d.created_at, (d.embedding <-> q::vector) as distance
  FROM documents d
  WHERE d.embedding IS NOT NULL
    AND (
      (p_workspace IS NOT NULL AND d.workspace_id = p_workspace)
      OR (p_workspace IS NULL AND d.user_id = p_user)
    )
  ORDER BY distance
  LIMIT p_top_k;
END;
$$ LANGUAGE plpgsql STABLE;
