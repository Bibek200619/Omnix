-- Workspace-native operational conversations. This domain is intentionally separate
-- from AI-session conversations/messages so human discussion remains authoritative.

CREATE TABLE IF NOT EXISTS public.workspace_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid,
  name text NOT NULL,
  slug text NOT NULL,
  purpose text,
  channel_type text NOT NULL DEFAULT 'operational',
  visibility text NOT NULL DEFAULT 'workspace',
  posting_policy text NOT NULL DEFAULT 'members',
  is_archived boolean NOT NULL DEFAULT false,
  message_count integer NOT NULL DEFAULT 0,
  last_message_preview text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_channels_type_check CHECK (channel_type IN ('operational', 'announcement')),
  CONSTRAINT workspace_channels_visibility_check CHECK (visibility IN ('workspace', 'private', 'project')),
  CONSTRAINT workspace_channels_posting_policy_check CHECK (posting_policy IN ('members', 'leaders')),
  CONSTRAINT workspace_channels_workspace_slug_key UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS public.workspace_channel_members (
  channel_id uuid NOT NULL REFERENCES public.workspace_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'participant',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_channel_members_pkey PRIMARY KEY (channel_id, user_id),
  CONSTRAINT workspace_channel_members_role_check CHECK (role IN ('participant', 'facilitator'))
);

CREATE TABLE IF NOT EXISTS public.workspace_channel_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.workspace_channels(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL,
  parent_message_id uuid REFERENCES public.workspace_channel_messages(id) ON DELETE CASCADE,
  content text NOT NULL,
  context_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_nonce text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  CONSTRAINT workspace_channel_messages_content_check CHECK (char_length(trim(content)) BETWEEN 1 AND 6000)
);

ALTER TABLE public.workspace_channels ADD COLUMN IF NOT EXISTS last_message_preview text;

DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_channels_created_by_auth_users_fkey') THEN
      ALTER TABLE public.workspace_channels
        ADD CONSTRAINT workspace_channels_created_by_auth_users_fkey
        FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_channel_members_user_id_auth_users_fkey') THEN
      ALTER TABLE public.workspace_channel_members
        ADD CONSTRAINT workspace_channel_members_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_channel_messages_author_auth_users_fkey') THEN
      ALTER TABLE public.workspace_channel_messages
        ADD CONSTRAINT workspace_channel_messages_author_auth_users_fkey
        FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    RAISE NOTICE 'Skipping workspace conversation auth foreign keys because auth.users is unavailable.';
  END;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_workspace_channels_workspace_active
  ON public.workspace_channels(workspace_id, is_archived, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_channel_members_user
  ON public.workspace_channel_members(user_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_workspace_channel_messages_channel_created
  ON public.workspace_channel_messages(channel_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_workspace_channel_messages_thread_created
  ON public.workspace_channel_messages(parent_message_id, created_at ASC)
  WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_channel_messages_context
  ON public.workspace_channel_messages USING gin(context_links);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_channel_messages_client_nonce
  ON public.workspace_channel_messages(channel_id, author_user_id, client_nonce)
  WHERE client_nonce IS NOT NULL;

INSERT INTO public.workspace_channels (
  workspace_id, created_by, name, slug, purpose, channel_type, visibility, posting_policy
)
SELECT
  w.id, NULL, 'announcements', 'announcements',
  'Durable operational updates and decisions that orient the workspace.',
  'announcement', 'workspace', 'leaders'
FROM public.workspaces w
ON CONFLICT (workspace_id, slug) DO NOTHING;

INSERT INTO public.workspace_channels (
  workspace_id, created_by, name, slug, purpose, channel_type, visibility, posting_policy
)
SELECT
  w.id, NULL, 'general', 'general',
  'Shared operational coordination for this workspace.',
  'operational', 'workspace', 'members'
FROM public.workspaces w
ON CONFLICT (workspace_id, slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_workspace_channel_from_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.workspace_channels
  SET message_count = message_count + 1,
      last_message_preview = CASE
        WHEN char_length(regexp_replace(trim(NEW.content), '\s+', ' ', 'g')) <= 110
          THEN regexp_replace(trim(NEW.content), '\s+', ' ', 'g')
        ELSE left(regexp_replace(trim(NEW.content), '\s+', ' ', 'g'), 107) || '...'
      END,
      last_message_at = NEW.created_at,
      updated_at = NEW.created_at
  WHERE id = NEW.channel_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_channel_message_insert_touch_channel ON public.workspace_channel_messages;
CREATE TRIGGER workspace_channel_message_insert_touch_channel
AFTER INSERT ON public.workspace_channel_messages
FOR EACH ROW EXECUTE FUNCTION public.touch_workspace_channel_from_message();

CREATE OR REPLACE FUNCTION public.omnix_has_workspace_conversation_access(target_workspace_id uuid)
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

CREATE OR REPLACE FUNCTION public.omnix_can_read_workspace_channel(target_channel_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_channels channel
    WHERE channel.id = target_channel_id
      AND public.omnix_has_workspace_conversation_access(channel.workspace_id)
      AND (
        channel.visibility = 'workspace'
        OR channel.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.workspace_channel_members member
          WHERE member.channel_id = channel.id AND member.user_id = auth.uid()
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.omnix_has_workspace_conversation_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omnix_can_read_workspace_channel(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omnix_has_workspace_conversation_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.omnix_can_read_workspace_channel(uuid) TO authenticated, service_role;

ALTER TABLE public.workspace_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_channel_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can receive visible channels" ON public.workspace_channels;
CREATE POLICY "Workspace members can receive visible channels"
  ON public.workspace_channels FOR SELECT TO authenticated
  USING (public.omnix_can_read_workspace_channel(id));

DROP POLICY IF EXISTS "Channel members can receive their membership" ON public.workspace_channel_members;
CREATE POLICY "Channel members can receive their membership"
  ON public.workspace_channel_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Workspace members can receive visible channel messages" ON public.workspace_channel_messages;
CREATE POLICY "Workspace members can receive visible channel messages"
  ON public.workspace_channel_messages FOR SELECT TO authenticated
  USING (public.omnix_can_read_workspace_channel(channel_id));

ALTER TABLE public.workspace_channels REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_channel_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_channels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_channels;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_channel_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_channel_messages;
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'Skipping operational conversation realtime publication setup: %', SQLERRM;
END;
$$;
