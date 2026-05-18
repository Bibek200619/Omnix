-- Migration: repair profile table columns for deployments that predate 0016.
-- Safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE profiles
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE profiles
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_username_format_check'
  ) THEN
    ALTER TABLE profiles
    ADD CONSTRAINT profiles_username_format_check
    CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9_-]{2,29}$');
  END IF;
END$$;

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

COMMIT;
