-- Migration: canonicalize workspace invite inviter column.

DO $$
DECLARE
  legacy_inviter_column text := 'invited_by' || '_user_id';
  legacy_inviter_constraint text := 'workspace_invites_' || legacy_inviter_column || '_fkey';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'workspace_invites'
      AND column_name = legacy_inviter_column
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'workspace_invites'
      AND column_name = 'invited_by'
  ) THEN
    EXECUTE format(
      'ALTER TABLE workspace_invites RENAME COLUMN %I TO invited_by',
      legacy_inviter_column
    );
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'workspace_invites'
      AND column_name = legacy_inviter_column
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'workspace_invites'
      AND column_name = 'invited_by'
  ) THEN
    EXECUTE format(
      'UPDATE workspace_invites SET invited_by = COALESCE(invited_by, %I)',
      legacy_inviter_column
    );
    EXECUTE format('ALTER TABLE workspace_invites DROP COLUMN %I', legacy_inviter_column);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = legacy_inviter_constraint
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_invites_invited_by_fkey'
  ) THEN
    EXECUTE format(
      'ALTER TABLE workspace_invites RENAME CONSTRAINT %I TO workspace_invites_invited_by_fkey',
      legacy_inviter_constraint
    );
  ELSIF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = legacy_inviter_constraint
  ) THEN
    EXECUTE format(
      'ALTER TABLE workspace_invites DROP CONSTRAINT %I',
      legacy_inviter_constraint
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_invites_invited_by_fkey'
  ) THEN
    BEGIN
      ALTER TABLE workspace_invites
      ADD CONSTRAINT workspace_invites_invited_by_fkey
      FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object OR undefined_column OR duplicate_object THEN
      RAISE NOTICE 'Skipping workspace_invites.invited_by FK normalization.';
    END;
  END IF;
END$$;
