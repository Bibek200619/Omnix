-- Workspace-scoped structured mentions. This table is intentionally awareness-only:
-- no notification, email, push, or automation behavior is attached to inserts.

CREATE TABLE IF NOT EXISTS public.workspace_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL,
  mentioned_by_user_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT workspace_mentions_source_type_check CHECK (
    source_type IN ('conversation_message', 'task', 'decision')
  )
);

DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_mentions_mentioned_user_auth_users_fkey') THEN
      ALTER TABLE public.workspace_mentions
        ADD CONSTRAINT workspace_mentions_mentioned_user_auth_users_fkey
        FOREIGN KEY (mentioned_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_mentions_actor_auth_users_fkey') THEN
      ALTER TABLE public.workspace_mentions
        ADD CONSTRAINT workspace_mentions_actor_auth_users_fkey
        FOREIGN KEY (mentioned_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    RAISE NOTICE 'Skipping workspace mention auth foreign keys because auth.users is unavailable.';
  END;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_workspace_mentions_workspace_created
  ON public.workspace_mentions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_mentions_inbox
  ON public.workspace_mentions(workspace_id, mentioned_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_mentions_source
  ON public.workspace_mentions(workspace_id, source_type, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_mentions_source_user
  ON public.workspace_mentions(workspace_id, source_type, source_id, mentioned_user_id);

ALTER TABLE public.workspace_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read workspace mentions" ON public.workspace_mentions;
CREATE POLICY "Workspace members can read workspace mentions"
  ON public.workspace_mentions FOR SELECT TO authenticated
  USING (
    public.omnix_has_workspace_task_access(workspace_id)
    AND (mentioned_user_id = auth.uid() OR mentioned_by_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members can create workspace mentions" ON public.workspace_mentions;
CREATE POLICY "Workspace members can create workspace mentions"
  ON public.workspace_mentions FOR INSERT TO authenticated
  WITH CHECK (
    public.omnix_has_workspace_task_access(workspace_id)
    AND mentioned_by_user_id = auth.uid()
  );

ALTER TABLE public.workspace_mentions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_mentions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_mentions;
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'Skipping workspace mention realtime publication setup: %', SQLERRM;
END;
$$;
