-- Workspace-native decisions. Decisions are durable organizational choices
-- with explicit source references when converted from operational discussion.

CREATE TABLE IF NOT EXISTS public.workspace_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  decision_reason text,
  status text NOT NULL DEFAULT 'accepted',
  source_message_id uuid,
  source_channel_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_decisions
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS source_message_id uuid,
  ADD COLUMN IF NOT EXISTS source_channel_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.workspace_decisions
  ALTER COLUMN status SET DEFAULT 'accepted',
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.workspace_decisions
  DROP CONSTRAINT IF EXISTS workspace_decisions_title_check,
  DROP CONSTRAINT IF EXISTS workspace_decisions_status_check;

ALTER TABLE public.workspace_decisions
  ADD CONSTRAINT workspace_decisions_title_check CHECK (char_length(trim(title)) BETWEEN 1 AND 180),
  ADD CONSTRAINT workspace_decisions_status_check CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded'));

DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_decisions_creator_auth_users_fkey') THEN
      ALTER TABLE public.workspace_decisions
        ADD CONSTRAINT workspace_decisions_creator_auth_users_fkey
        FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    RAISE NOTICE 'Skipping workspace decision auth foreign key because auth.users is unavailable.';
  END;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_workspace_decisions_workspace_updated
  ON public.workspace_decisions(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_decisions_workspace_status
  ON public.workspace_decisions(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_decisions_source_message
  ON public.workspace_decisions(workspace_id, source_channel_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.omnix_has_workspace_decision_access(target_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = target_workspace_id
      AND (
        w.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members direct_member
          WHERE direct_member.workspace_id = w.id AND direct_member.user_id = auth.uid()
        )
        OR (
          w.parent_workspace_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM public.workspaces parent
              WHERE parent.id = w.parent_workspace_id AND parent.user_id = auth.uid()
            )
            OR (
              w.is_global = true
              AND EXISTS (
                SELECT 1 FROM public.workspace_members parent_member
                WHERE parent_member.workspace_id = w.parent_workspace_id
                  AND parent_member.user_id = auth.uid()
              )
            )
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.omnix_has_workspace_decision_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omnix_has_workspace_decision_access(uuid) TO authenticated, service_role;

ALTER TABLE public.workspace_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can receive organizational decisions" ON public.workspace_decisions;
CREATE POLICY "Workspace members can receive organizational decisions"
  ON public.workspace_decisions FOR SELECT TO authenticated
  USING (public.omnix_has_workspace_decision_access(workspace_id));
