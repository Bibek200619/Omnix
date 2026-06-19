-- Decision Traceability: Linkages and Lifecycle.
-- This migration enables decisions to be linked to tasks and initiatives,
-- transforming them into organizational memory objects.

-- 1. Add initiative linkage to decisions
ALTER TABLE public.workspace_decisions
  ADD COLUMN IF NOT EXISTS initiative_id uuid REFERENCES public.workspace_initiatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_decisions_initiative
  ON public.workspace_decisions(initiative_id)
  WHERE initiative_id IS NOT NULL;

-- 2. Create join table for decision ↔ task linkage (Many-to-Many)
CREATE TABLE IF NOT EXISTS public.workspace_decision_tasks (
  decision_id uuid NOT NULL REFERENCES public.workspace_decisions(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.workspace_tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_decision_tasks_task
  ON public.workspace_decision_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_workspace_decision_tasks_workspace
  ON public.workspace_decision_tasks(workspace_id);

-- 3. RLS Policies
ALTER TABLE public.workspace_decision_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read decision tasks" ON public.workspace_decision_tasks;
CREATE POLICY "Workspace members can read decision tasks"
  ON public.workspace_decision_tasks FOR SELECT TO authenticated
  USING (public.omnix_has_workspace_decision_access(workspace_id));

-- 4. Realtime configuration
ALTER TABLE public.workspace_decisions REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_decision_tasks REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  -- Add tables if not already present
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_decisions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_decisions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_decision_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_decision_tasks;
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'Skipping traceability realtime publication setup: %', SQLERRM;
END;
$$;
