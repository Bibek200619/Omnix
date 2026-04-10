-- Migration: repair profile table columns for deployments that predate 0016.
-- Safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS handle text,
  ADD COLUMN IF NOT EXISTS display_name text,
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
    WHERE conname = 'profiles_handle_format_check'
  ) THEN
    ALTER TABLE profiles
    ADD CONSTRAINT profiles_handle_format_check
    CHECK (handle IS NULL OR handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_user_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE profiles
      ADD CONSTRAINT profiles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping profiles.user_id FK creation - auth.users not available.';
    END;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_handle_lower
ON profiles(lower(handle))
WHERE handle IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_user_id
ON profiles(user_id);

INSERT INTO profiles (user_id, created_at, updated_at)
SELECT DISTINCT wm.user_id, now(), now()
FROM workspace_members wm
WHERE wm.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO profiles (user_id, created_at, updated_at)
SELECT DISTINCT w.user_id, now(), now()
FROM workspaces w
WHERE w.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
