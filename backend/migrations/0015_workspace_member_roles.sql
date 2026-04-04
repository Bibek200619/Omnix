-- Migration: add co-owner workspace membership role.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_members_role_check'
  ) THEN
    ALTER TABLE workspace_members
    DROP CONSTRAINT workspace_members_role_check;
  END IF;

  ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'co_owner', 'member'));
END$$;
