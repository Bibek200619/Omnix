-- Workspace-native operational tasks. Tasks remain lightweight execution records
-- with explicit provenance; momentum is derived from recorded state only.

CREATE TABLE IF NOT EXISTS public.workspace_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'idea',
  owner_user_id uuid,
  created_by uuid NOT NULL,
  due_date date,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_context jsonb NOT NULL DEFAULT '[]'::jsonb,
  activity_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  momentum_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiative_id uuid REFERENCES public.workspace_initiatives(id) ON DELETE SET NULL,
  client_nonce text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_tasks_title_check CHECK (char_length(trim(title)) BETWEEN 1 AND 180),
  CONSTRAINT workspace_tasks_status_check CHECK (status IN ('idea', 'planned', 'active', 'review', 'complete'))
);

DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_tasks_owner_auth_users_fkey') THEN
      ALTER TABLE public.workspace_tasks
        ADD CONSTRAINT workspace_tasks_owner_auth_users_fkey
        FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_tasks_created_by_auth_users_fkey') THEN
      ALTER TABLE public.workspace_tasks
        ADD CONSTRAINT workspace_tasks_created_by_auth_users_fkey
        FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    RAISE NOTICE 'Skipping workspace task auth foreign keys because auth.users is unavailable.';
  END;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_workspace_tasks_workspace_updated
  ON public.workspace_tasks(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_workspace_status
  ON public.workspace_tasks(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_owner_open
  ON public.workspace_tasks(owner_user_id, status, updated_at DESC)
  WHERE status <> 'complete';
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_due_open
  ON public.workspace_tasks(workspace_id, due_date)
  WHERE status <> 'complete' AND due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_blockers
  ON public.workspace_tasks USING gin(blockers);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_linked_context
  ON public.workspace_tasks USING gin(linked_context);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_tasks_client_nonce
  ON public.workspace_tasks(workspace_id, created_by, client_nonce)
  WHERE client_nonce IS NOT NULL;

CREATE OR REPLACE FUNCTION public.omnix_has_workspace_task_access(target_workspace_id uuid)
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

REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omnix_has_workspace_task_access(uuid) TO authenticated, service_role;

ALTER TABLE public.workspace_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can receive operational tasks" ON public.workspace_tasks;
CREATE POLICY "Workspace members can receive operational tasks"
  ON public.workspace_tasks FOR SELECT TO authenticated
  USING (public.omnix_has_workspace_task_access(workspace_id));

ALTER TABLE public.workspace_tasks REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_tasks;
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'Skipping operational task realtime publication setup: %', SQLERRM;
END;
$$;
