-- Ambient operational identity for workspace conversation participants.
-- This descriptive label does not grant or imply authorization.

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS operational_label text;

ALTER TABLE public.workspace_members
  DROP CONSTRAINT IF EXISTS workspace_members_operational_label_length_check;

ALTER TABLE public.workspace_members
  ADD CONSTRAINT workspace_members_operational_label_length_check
  CHECK (operational_label IS NULL OR char_length(trim(operational_label)) BETWEEN 1 AND 80)
  NOT VALID;
