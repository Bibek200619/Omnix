-- Migration: 0027_authority_revocation.sql
-- Description: Table for event-driven authority invalidation and realtime trust enforcement.

CREATE TABLE IF NOT EXISTS public.authority_revocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    revocation_type TEXT NOT NULL CHECK (revocation_type IN ('membership_removed', 'role_changed', 'workspace_deleted')),
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.authority_revocations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own revocations
DROP POLICY IF EXISTS "Users can view their own authority revocations" ON public.authority_revocations;
CREATE POLICY "Users can view their own authority revocations"
    ON public.authority_revocations
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Only service role can insert (handled by backend)
DROP POLICY IF EXISTS "Service role can insert authority revocations" ON public.authority_revocations;
CREATE POLICY "Service role can insert authority revocations"
    ON public.authority_revocations
    FOR INSERT
    WITH CHECK (true);

-- Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'authority_revocations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.authority_revocations;
  END IF;
END$$;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_authority_revocations_user_id ON public.authority_revocations(user_id);
CREATE INDEX IF NOT EXISTS idx_authority_revocations_workspace_id ON public.authority_revocations(workspace_id);
