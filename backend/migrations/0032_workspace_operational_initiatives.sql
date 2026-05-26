-- Workspace-native operational initiatives. An initiative provides shared
-- direction without introducing hierarchy or synthetic productivity scores.

ALTER TABLE public.workspace_initiatives
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS target_date date,
  ADD COLUMN IF NOT EXISTS initiative_context text,
  ADD COLUMN IF NOT EXISTS linked_resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS momentum_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS activity_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS client_nonce text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE public.workspace_initiatives
SET title = COALESCE(NULLIF(trim(title), ''), name),
    status = CASE
      WHEN status = 'completed' THEN 'complete'
      WHEN status = 'paused' THEN 'draft'
      ELSE status
    END
WHERE title IS NULL
   OR trim(title) = ''
   OR status IN ('completed', 'paused');

ALTER TABLE public.workspace_initiatives
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.workspace_initiatives
  DROP CONSTRAINT IF EXISTS workspace_initiatives_status_check;

ALTER TABLE public.workspace_initiatives
  ADD CONSTRAINT workspace_initiatives_title_check CHECK (char_length(trim(title)) BETWEEN 1 AND 180),
  ADD CONSTRAINT workspace_initiatives_status_check CHECK (status IN ('draft', 'active', 'focused', 'at_risk', 'complete'));

DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_initiatives_owner_auth_users_fkey') THEN
      ALTER TABLE public.workspace_initiatives
        ADD CONSTRAINT workspace_initiatives_owner_auth_users_fkey
        FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_initiatives_creator_auth_users_fkey') THEN
      ALTER TABLE public.workspace_initiatives
        ADD CONSTRAINT workspace_initiatives_creator_auth_users_fkey
        FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    RAISE NOTICE 'Skipping workspace initiative auth foreign keys because auth.users is unavailable.';
  END;
END;
$$;

CREATE TABLE IF NOT EXISTS public.workspace_initiative_channels (
  initiative_id uuid NOT NULL REFERENCES public.workspace_initiatives(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.workspace_channels(id) ON DELETE CASCADE,
  attached_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_initiative_channels_pkey PRIMARY KEY (initiative_id, channel_id)
);

DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_initiative_channels_actor_auth_users_fkey') THEN
      ALTER TABLE public.workspace_initiative_channels
        ADD CONSTRAINT workspace_initiative_channels_actor_auth_users_fkey
        FOREIGN KEY (attached_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    RAISE NOTICE 'Skipping initiative channel actor foreign key because auth.users is unavailable.';
  END;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_workspace_initiatives_workspace_updated
  ON public.workspace_initiatives(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_initiatives_workspace_status
  ON public.workspace_initiatives(workspace_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_initiatives_client_nonce
  ON public.workspace_initiatives(workspace_id, created_by, client_nonce)
  WHERE client_nonce IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_initiative_updated
  ON public.workspace_tasks(initiative_id, updated_at DESC)
  WHERE initiative_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_initiative_channels_workspace
  ON public.workspace_initiative_channels(workspace_id, initiative_id);

ALTER TABLE public.workspace_initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_initiative_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can receive operational initiatives" ON public.workspace_initiatives;
CREATE POLICY "Workspace members can receive operational initiatives"
  ON public.workspace_initiatives FOR SELECT TO authenticated
  USING (public.omnix_has_workspace_task_access(workspace_id));

DROP POLICY IF EXISTS "Workspace members can receive initiative channels" ON public.workspace_initiative_channels;
CREATE POLICY "Workspace members can receive initiative channels"
  ON public.workspace_initiative_channels FOR SELECT TO authenticated
  USING (
    public.omnix_has_workspace_task_access(workspace_id)
    AND public.omnix_can_read_workspace_channel(channel_id)
  );

ALTER TABLE public.workspace_initiatives REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_initiative_channels REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_initiatives'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_initiatives;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_initiative_channels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_initiative_channels;
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'Skipping operational initiative realtime publication setup: %', SQLERRM;
END;
$$;
