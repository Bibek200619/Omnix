-- Migration: app profile identities and role-aware workspace invites.

BEGIN;

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY,
  username text,
  name text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT profiles_username_format_check
    CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9_-]{2,29}$')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE profiles
      ADD CONSTRAINT profiles_id_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping profiles.id FK creation - auth.users not available.';
    END;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_username_lower
ON profiles(lower(username))
WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_id
ON profiles(id);

INSERT INTO profiles (id, created_at, updated_at)
SELECT DISTINCT wm.user_id, now(), now()
FROM workspace_members wm
WHERE wm.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, created_at, updated_at)
SELECT DISTINCT w.user_id, now(), now()
FROM workspaces w
WHERE w.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

UPDATE workspace_members wm
SET role = 'co_owner',
    updated_at = now()
FROM workspaces w
WHERE wm.workspace_id = w.id
  AND wm.role = 'owner'
  AND wm.user_id <> w.user_id;

ALTER TABLE workspace_members
DROP CONSTRAINT IF EXISTS workspace_members_role_check;

ALTER TABLE workspace_members
ADD CONSTRAINT workspace_members_role_check
CHECK (role IN ('owner', 'co_owner', 'member'));

ALTER TABLE workspace_invites
DROP CONSTRAINT IF EXISTS workspace_invites_role_check;

ALTER TABLE workspace_invites
ADD CONSTRAINT workspace_invites_role_check
CHECK (role IN ('co_owner', 'member'));

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status_created_at
ON workspace_invites(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_email_status_created_at
ON workspace_invites(lower(email), status, created_at DESC);

COMMIT;
