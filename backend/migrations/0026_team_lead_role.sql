-- Migration: add team_lead workspace membership role.

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
  CHECK (role IN ('owner', 'founder', 'co_owner', 'team_lead', 'member'));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_invites_role_check'
  ) THEN
    ALTER TABLE workspace_invites
    DROP CONSTRAINT workspace_invites_role_check;
  END IF;

  ALTER TABLE workspace_invites
  ADD CONSTRAINT workspace_invites_role_check
  CHECK (role IN ('co_owner', 'team_lead', 'member'));
END$$;
