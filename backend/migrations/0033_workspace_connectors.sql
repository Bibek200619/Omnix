-- Workspace-scoped connector configurations and rollout state.
CREATE TABLE IF NOT EXISTS public.workspace_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  connector_type text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'request_submitted',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  job_id uuid,
  source_file_id uuid,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_connectors_type_check CHECK (
    connector_type IN ('knowledge_link', 'file_repository', 'company_drive', 'external_database')
  ),
  CONSTRAINT workspace_connectors_status_check CHECK (
    status IN (
      'live',
      'connecting',
      'connected',
      'syncing',
      'failed',
      'pending_ingestion',
      'request_submitted',
      'needs_authentication'
    )
  )
);

ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS connector_type text;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS status text DEFAULT 'request_submitted';
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS job_id uuid;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS source_file_id uuid;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_connectors ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_connectors ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.workspace_connectors ALTER COLUMN status SET DEFAULT 'request_submitted';
ALTER TABLE public.workspace_connectors ALTER COLUMN config SET DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_connectors ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.workspace_connectors ALTER COLUMN updated_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_workspace_connectors_workspace ON public.workspace_connectors(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_connectors_user ON public.workspace_connectors(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_connectors_type_status ON public.workspace_connectors(connector_type, status);
CREATE INDEX IF NOT EXISTS idx_workspace_connectors_job ON public.workspace_connectors(job_id);
