-- Omnix backend schema baseline audit.
-- This migration is intentionally idempotent and repairs schema drift introduced by
-- partially-applied historical migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION public.omnix_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  email text,
  name text,
  username text,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  parent_workspace_id uuid,
  workspace_type text NOT NULL DEFAULT 'super_workspace',
  is_global boolean NOT NULL DEFAULT false,
  expertise_area text,
  workspace_focus text DEFAULT 'general',
  ai_specialization text DEFAULT 'general',
  ai_instructions text,
  intelligence_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS parent_workspace_id uuid;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS workspace_type text DEFAULT 'super_workspace';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS is_global boolean DEFAULT false;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS expertise_area text;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS workspace_focus text DEFAULT 'general';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS ai_specialization text DEFAULT 'general';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS ai_instructions text;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS intelligence_preferences jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.workspaces ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.workspaces ALTER COLUMN workspace_type SET DEFAULT 'super_workspace';
ALTER TABLE public.workspaces ALTER COLUMN is_global SET DEFAULT false;
ALTER TABLE public.workspaces ALTER COLUMN workspace_focus SET DEFAULT 'general';
ALTER TABLE public.workspaces ALTER COLUMN ai_specialization SET DEFAULT 'general';
ALTER TABLE public.workspaces ALTER COLUMN intelligence_preferences SET DEFAULT '{}'::jsonb;
ALTER TABLE public.workspaces ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.workspaces ALTER COLUMN updated_at SET DEFAULT now();

UPDATE public.workspaces
SET workspace_focus = CASE
  WHEN lower(coalesce(workspace_focus, ai_specialization, 'general')) IN ('engineering', 'coding', 'code', 'dev', 'development', 'technical') THEN 'engineering'
  WHEN lower(coalesce(workspace_focus, ai_specialization, 'general')) = 'design' THEN 'design'
  WHEN lower(coalesce(workspace_focus, ai_specialization, 'general')) IN ('research', 'analytics', 'analysis', 'data') THEN 'research'
  WHEN lower(coalesce(workspace_focus, ai_specialization, 'general')) IN ('strategy', 'product', 'planning') THEN 'strategy'
  ELSE 'general'
END
WHERE workspace_focus IS NULL
   OR workspace_focus NOT IN ('general', 'engineering', 'design', 'research', 'strategy');

UPDATE public.workspaces
SET ai_specialization = workspace_focus
WHERE ai_specialization IS NULL
   OR ai_specialization NOT IN ('general', 'engineering', 'design', 'research', 'strategy')
   OR ai_specialization <> workspace_focus;

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS role text DEFAULT 'member';
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_members ALTER COLUMN role SET DEFAULT 'member';
ALTER TABLE public.workspace_members ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.workspace_members ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid,
  accepted_by_user_id uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS role text DEFAULT 'member';
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS invited_by uuid;
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS accepted_by_user_id uuid;
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_invites ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.workspace_invites ALTER COLUMN role SET DEFAULT 'member';
ALTER TABLE public.workspace_invites ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.workspace_invites ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.workspace_invites ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid,
  title text NOT NULL DEFAULT 'New conversation',
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS title text DEFAULT 'New conversation';
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_message_at timestamptz DEFAULT now();
ALTER TABLE public.conversations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.conversations ALTER COLUMN title SET DEFAULT 'New conversation';
ALTER TABLE public.conversations ALTER COLUMN is_archived SET DEFAULT false;
ALTER TABLE public.conversations ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.conversations ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.conversations ALTER COLUMN last_message_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'completed',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS content text DEFAULT '';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.messages ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.messages ALTER COLUMN content SET DEFAULT '';
ALTER TABLE public.messages ALTER COLUMN status SET DEFAULT 'completed';
ALTER TABLE public.messages ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE public.messages ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE public.messages ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid,
  conversation_id uuid,
  file_name text NOT NULL,
  file_type text,
  size_bytes bigint,
  storage_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.files ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS size_bytes bigint;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.files ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.files ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE public.files ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.files ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_id uuid,
  workspace_id uuid,
  content text NOT NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  embedding vector(384),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_id uuid;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS chunk_index integer DEFAULT 0;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.documents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.documents ALTER COLUMN chunk_index SET DEFAULT 0;
ALTER TABLE public.documents ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE public.documents ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.documents ALTER COLUMN updated_at SET DEFAULT now();

DROP INDEX IF EXISTS public.idx_documents_embedding;
DROP INDEX IF EXISTS public.idx_documents_embedding_384;
DROP INDEX IF EXISTS public.idx_documents_embedding_cosine;

DO $$
DECLARE
  current_embedding_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO current_embedding_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.documents'::regclass
    AND a.attname = 'embedding'
    AND NOT a.attisdropped;

  IF current_embedding_type IS NULL THEN
    ALTER TABLE public.documents ADD COLUMN embedding vector(384);
  ELSIF current_embedding_type <> 'vector(384)' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'public.documents'::regclass
        AND attname = 'embedding_legacy'
        AND NOT attisdropped
    ) THEN
      ALTER TABLE public.documents RENAME COLUMN embedding TO embedding_legacy;
    ELSE
      ALTER TABLE public.documents DROP COLUMN embedding;
    END IF;

    ALTER TABLE public.documents ADD COLUMN embedding vector(384);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'document',
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS type text DEFAULT 'document';
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS content text DEFAULT '';
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false;
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.artifacts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.artifacts ALTER COLUMN type SET DEFAULT 'document';
ALTER TABLE public.artifacts ALTER COLUMN content SET DEFAULT '';
ALTER TABLE public.artifacts ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE public.artifacts ALTER COLUMN pinned SET DEFAULT false;
ALTER TABLE public.artifacts ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.artifacts ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cache_key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cache ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.cache ADD COLUMN IF NOT EXISTS cache_key text;
ALTER TABLE public.cache ADD COLUMN IF NOT EXISTS value jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.cache ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.cache ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.cache ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.cache ALTER COLUMN value SET DEFAULT '{}'::jsonb;
ALTER TABLE public.cache ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.cache ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  status integer NOT NULL,
  response_time_ms numeric,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS endpoint text;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS status integer;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS response_time_ms numeric;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.api_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.api_logs ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid,
  name text NOT NULL,
  job_type text NOT NULL,
  schedule text,
  interval_seconds integer,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS job_type text;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS schedule text;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS interval_seconds integer;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.automations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.automations ALTER COLUMN enabled SET DEFAULT true;
ALTER TABLE public.automations ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.automations ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result_artifact_id uuid,
  log text
);

ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS automation_id uuid;
ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS started_at timestamptz DEFAULT now();
ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS result_artifact_id uuid;
ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS log text;
ALTER TABLE public.automation_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.automation_logs ALTER COLUMN started_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS status text DEFAULT 'queued';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS progress integer DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS result jsonb;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.jobs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.jobs ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE public.jobs ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE public.jobs ALTER COLUMN progress SET DEFAULT 0;
ALTER TABLE public.jobs ALTER COLUMN attempts SET DEFAULT 0;
ALTER TABLE public.jobs ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.google_drive_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid,
  provider text NOT NULL DEFAULT 'google_drive',
  access_token text NOT NULL,
  refresh_token text,
  scope text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS provider text DEFAULT 'google_drive';
ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS access_token text;
ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS refresh_token text;
ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.google_drive_tokens ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.google_drive_tokens ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.google_drive_tokens ALTER COLUMN provider SET DEFAULT 'google_drive';
ALTER TABLE public.google_drive_tokens ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.google_drive_tokens ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspace_presence (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'online',
  current_view text,
  current_label text,
  typing_until timestamptz,
  typing_conversation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS status text DEFAULT 'online';
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS current_view text;
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS current_label text;
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS typing_until timestamptz;
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS typing_conversation_id uuid;
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_presence ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_presence ALTER COLUMN status SET DEFAULT 'online';
ALTER TABLE public.workspace_presence ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_presence ALTER COLUMN last_seen_at SET DEFAULT now();
ALTER TABLE public.workspace_presence ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.workspace_presence ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspace_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_activity_events ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_activity_events ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE public.workspace_activity_events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.workspace_activity_events ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.workspace_activity_events ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_activity_events ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_activity_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.workspace_activity_events ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_activity_events ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspace_initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  momentum_score double precision NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_initiatives ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_initiatives ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.workspace_initiatives ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.workspace_initiatives ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.workspace_initiatives ADD COLUMN IF NOT EXISTS momentum_score double precision DEFAULT 0;
ALTER TABLE public.workspace_initiatives ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_initiatives ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_initiatives ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_initiatives ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.workspace_initiatives ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.workspace_initiatives ALTER COLUMN momentum_score SET DEFAULT 0;
ALTER TABLE public.workspace_initiatives ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_initiatives ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.workspace_initiatives ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspace_intelligence_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  memory_type text NOT NULL,
  content text NOT NULL,
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  importance_score double precision NOT NULL DEFAULT 0.5,
  valid_until timestamptz,
  initiative_id uuid,
  resolution_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS memory_type text;
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS structured_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS importance_score double precision DEFAULT 0.5;
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS valid_until timestamptz;
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS initiative_id uuid;
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS resolution_status text;
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_intelligence_memory ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_intelligence_memory ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.workspace_intelligence_memory ALTER COLUMN structured_data SET DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_intelligence_memory ALTER COLUMN importance_score SET DEFAULT 0.5;
ALTER TABLE public.workspace_intelligence_memory ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.workspace_intelligence_memory ALTER COLUMN updated_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspace_momentum_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  initiative_id uuid,
  score double precision NOT NULL DEFAULT 0,
  active_collaborators integer NOT NULL DEFAULT 0,
  synthesis_events integer NOT NULL DEFAULT 0,
  unresolved_threads integer NOT NULL DEFAULT 0,
  snapshot_timestamp timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.workspace_momentum_snapshots ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_momentum_snapshots ADD COLUMN IF NOT EXISTS initiative_id uuid;
ALTER TABLE public.workspace_momentum_snapshots ADD COLUMN IF NOT EXISTS score double precision DEFAULT 0;
ALTER TABLE public.workspace_momentum_snapshots ADD COLUMN IF NOT EXISTS active_collaborators integer DEFAULT 0;
ALTER TABLE public.workspace_momentum_snapshots ADD COLUMN IF NOT EXISTS synthesis_events integer DEFAULT 0;
ALTER TABLE public.workspace_momentum_snapshots ADD COLUMN IF NOT EXISTS unresolved_threads integer DEFAULT 0;
ALTER TABLE public.workspace_momentum_snapshots ADD COLUMN IF NOT EXISTS snapshot_timestamp timestamptz DEFAULT now();
ALTER TABLE public.workspace_momentum_snapshots ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_momentum_snapshots ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.workspace_momentum_snapshots ALTER COLUMN score SET DEFAULT 0;
ALTER TABLE public.workspace_momentum_snapshots ALTER COLUMN active_collaborators SET DEFAULT 0;
ALTER TABLE public.workspace_momentum_snapshots ALTER COLUMN synthesis_events SET DEFAULT 0;
ALTER TABLE public.workspace_momentum_snapshots ALTER COLUMN unresolved_threads SET DEFAULT 0;
ALTER TABLE public.workspace_momentum_snapshots ALTER COLUMN snapshot_timestamp SET DEFAULT now();
ALTER TABLE public.workspace_momentum_snapshots ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.workspace_operational_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  initiative_id uuid,
  event_type text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_operational_timeline ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.workspace_operational_timeline ADD COLUMN IF NOT EXISTS initiative_id uuid;
ALTER TABLE public.workspace_operational_timeline ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.workspace_operational_timeline ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.workspace_operational_timeline ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_operational_timeline ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.workspace_operational_timeline ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.workspace_operational_timeline ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE public.workspace_operational_timeline ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.authority_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  revocation_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.authority_revocations ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.authority_revocations ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.authority_revocations ADD COLUMN IF NOT EXISTS revocation_type text;
ALTER TABLE public.authority_revocations ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.authority_revocations ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.authority_revocations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.authority_revocations ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE public.authority_revocations ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indrelid = 'public.workspace_members'::regclass AND indisprimary
  ) THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indrelid = 'public.workspace_presence'::regclass AND indisprimary
  ) THEN
    ALTER TABLE public.workspace_presence
      ADD CONSTRAINT workspace_presence_pkey PRIMARY KEY (workspace_id, user_id);
  END IF;
END;
$$;

DO $$
DECLARE
  tbl regclass;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'public.profiles'::regclass,
    'public.workspaces'::regclass,
    'public.workspace_invites'::regclass,
    'public.conversations'::regclass,
    'public.messages'::regclass,
    'public.files'::regclass,
    'public.documents'::regclass,
    'public.artifacts'::regclass,
    'public.cache'::regclass,
    'public.api_logs'::regclass,
    'public.automations'::regclass,
    'public.automation_logs'::regclass,
    'public.jobs'::regclass,
    'public.google_drive_tokens'::regclass,
    'public.workspace_activity_events'::regclass,
    'public.workspace_initiatives'::regclass,
    'public.workspace_intelligence_memory'::regclass,
    'public.workspace_momentum_snapshots'::regclass,
    'public.workspace_operational_timeline'::regclass,
    'public.authority_revocations'::regclass
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index
      WHERE indrelid = tbl AND indisprimary
    ) THEN
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I PRIMARY KEY (id)',
        tbl,
        replace(tbl::text, '.', '_') || '_pkey'
      );
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_workspace_type_check;
ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_workspace_focus_check;
ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_ai_specialization_check;
ALTER TABLE public.workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE public.workspace_invites DROP CONSTRAINT IF EXISTS workspace_invites_role_check;
ALTER TABLE public.workspace_invites DROP CONSTRAINT IF EXISTS workspace_invites_status_check;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_format_check;
ALTER TABLE public.workspace_presence DROP CONSTRAINT IF EXISTS workspace_presence_status_check;
ALTER TABLE public.workspace_initiatives DROP CONSTRAINT IF EXISTS workspace_initiatives_status_check;
ALTER TABLE public.workspace_intelligence_memory DROP CONSTRAINT IF EXISTS workspace_intelligence_memory_resolution_status_check;
ALTER TABLE public.authority_revocations DROP CONSTRAINT IF EXISTS authority_revocations_revocation_type_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_workspace_type_check
  CHECK (workspace_type IN ('workspace', 'super_workspace', 'subworkspace', 'global_workspace', 'super', 'sub', 'global', 'project', 'team', 'personal'))
  NOT VALID;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_workspace_focus_check
  CHECK (workspace_focus IS NULL OR workspace_focus IN ('general', 'engineering', 'design', 'research', 'strategy'))
  NOT VALID;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_ai_specialization_check
  CHECK (ai_specialization IS NULL OR ai_specialization IN ('general', 'engineering', 'design', 'research', 'strategy'))
  NOT VALID;

ALTER TABLE public.workspace_members
  ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'founder', 'super_founder', 'co_owner', 'team_lead', 'sub_leader', 'sub_member', 'member'))
  NOT VALID;

ALTER TABLE public.workspace_invites
  ADD CONSTRAINT workspace_invites_role_check
  CHECK (role IN ('owner', 'founder', 'super_founder', 'co_owner', 'team_lead', 'sub_leader', 'sub_member', 'member'))
  NOT VALID;

ALTER TABLE public.workspace_invites
  ADD CONSTRAINT workspace_invites_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'))
  NOT VALID;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_role_check
  CHECK (role IN ('user', 'assistant', 'system', 'tool'))
  NOT VALID;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_status_check
  CHECK (status IN ('pending', 'streaming', 'completed', 'failed'))
  NOT VALID;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_check
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9_-]{2,29}$')
  NOT VALID;

ALTER TABLE public.workspace_presence
  ADD CONSTRAINT workspace_presence_status_check
  CHECK (status IN ('online', 'idle', 'offline'))
  NOT VALID;

ALTER TABLE public.workspace_initiatives
  ADD CONSTRAINT workspace_initiatives_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'archived'))
  NOT VALID;

ALTER TABLE public.workspace_intelligence_memory
  ADD CONSTRAINT workspace_intelligence_memory_resolution_status_check
  CHECK (resolution_status IS NULL OR resolution_status IN ('unresolved', 'resolved', 'pending_collaboration', 'blocked'))
  NOT VALID;

ALTER TABLE public.authority_revocations
  ADD CONSTRAINT authority_revocations_revocation_type_check
  CHECK (revocation_type IN ('membership_removed', 'role_changed', 'workspace_deleted'))
  NOT VALID;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_auth_users_fkey') THEN
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_id_auth_users_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_user_id_auth_users_fkey') THEN
      ALTER TABLE public.workspaces
        ADD CONSTRAINT workspaces_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_user_id_auth_users_fkey') THEN
      ALTER TABLE public.workspace_members
        ADD CONSTRAINT workspace_members_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_invited_by_auth_users_fkey') THEN
      ALTER TABLE public.workspace_invites
        ADD CONSTRAINT workspace_invites_invited_by_auth_users_fkey
        FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_accepted_by_user_id_auth_users_fkey') THEN
      ALTER TABLE public.workspace_invites
        ADD CONSTRAINT workspace_invites_accepted_by_user_id_auth_users_fkey
        FOREIGN KEY (accepted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_user_id_auth_users_fkey') THEN
      ALTER TABLE public.conversations
        ADD CONSTRAINT conversations_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_user_id_auth_users_fkey') THEN
      ALTER TABLE public.messages
        ADD CONSTRAINT messages_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_user_id_auth_users_fkey') THEN
      ALTER TABLE public.files
        ADD CONSTRAINT files_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_user_id_auth_users_fkey') THEN
      ALTER TABLE public.documents
        ADD CONSTRAINT documents_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_user_id_auth_users_fkey') THEN
      ALTER TABLE public.artifacts
        ADD CONSTRAINT artifacts_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cache_user_id_auth_users_fkey') THEN
      ALTER TABLE public.cache
        ADD CONSTRAINT cache_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_logs_user_id_auth_users_fkey') THEN
      ALTER TABLE public.api_logs
        ADD CONSTRAINT api_logs_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automations_user_id_auth_users_fkey') THEN
      ALTER TABLE public.automations
        ADD CONSTRAINT automations_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_drive_tokens_user_id_auth_users_fkey') THEN
      ALTER TABLE public.google_drive_tokens
        ADD CONSTRAINT google_drive_tokens_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_presence_user_id_auth_users_fkey') THEN
      ALTER TABLE public.workspace_presence
        ADD CONSTRAINT workspace_presence_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_activity_events_actor_user_id_auth_users_fkey') THEN
      ALTER TABLE public.workspace_activity_events
        ADD CONSTRAINT workspace_activity_events_actor_user_id_auth_users_fkey
        FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_revocations_user_id_auth_users_fkey') THEN
      ALTER TABLE public.authority_revocations
        ADD CONSTRAINT authority_revocations_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_parent_workspace_id_fkey') THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_parent_workspace_id_fkey
      FOREIGN KEY (parent_workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_workspace_id_fkey') THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_workspace_id_fkey') THEN
    ALTER TABLE public.workspace_invites
      ADD CONSTRAINT workspace_invites_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_workspace_id_fkey') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_id_fkey') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_workspace_id_fkey') THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_conversation_id_fkey') THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_workspace_id_fkey') THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_workspace_id_fkey') THEN
    ALTER TABLE public.artifacts
      ADD CONSTRAINT artifacts_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automations_workspace_id_fkey') THEN
    ALTER TABLE public.automations
      ADD CONSTRAINT automations_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_logs_automation_id_fkey') THEN
    ALTER TABLE public.automation_logs
      ADD CONSTRAINT automation_logs_automation_id_fkey
      FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_logs_workspace_id_fkey') THEN
    ALTER TABLE public.automation_logs
      ADD CONSTRAINT automation_logs_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_logs_result_artifact_id_fkey') THEN
    ALTER TABLE public.automation_logs
      ADD CONSTRAINT automation_logs_result_artifact_id_fkey
      FOREIGN KEY (result_artifact_id) REFERENCES public.artifacts(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_drive_tokens_workspace_id_fkey') THEN
    ALTER TABLE public.google_drive_tokens
      ADD CONSTRAINT google_drive_tokens_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_presence_workspace_id_fkey') THEN
    ALTER TABLE public.workspace_presence
      ADD CONSTRAINT workspace_presence_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_presence_typing_conversation_id_fkey') THEN
    ALTER TABLE public.workspace_presence
      ADD CONSTRAINT workspace_presence_typing_conversation_id_fkey
      FOREIGN KEY (typing_conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_activity_events_workspace_id_fkey') THEN
    ALTER TABLE public.workspace_activity_events
      ADD CONSTRAINT workspace_activity_events_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_initiatives_workspace_id_fkey') THEN
    ALTER TABLE public.workspace_initiatives
      ADD CONSTRAINT workspace_initiatives_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_intelligence_memory_workspace_id_fkey') THEN
    ALTER TABLE public.workspace_intelligence_memory
      ADD CONSTRAINT workspace_intelligence_memory_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_intelligence_memory_initiative_id_fkey') THEN
    ALTER TABLE public.workspace_intelligence_memory
      ADD CONSTRAINT workspace_intelligence_memory_initiative_id_fkey
      FOREIGN KEY (initiative_id) REFERENCES public.workspace_initiatives(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_momentum_snapshots_workspace_id_fkey') THEN
    ALTER TABLE public.workspace_momentum_snapshots
      ADD CONSTRAINT workspace_momentum_snapshots_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_momentum_snapshots_initiative_id_fkey') THEN
    ALTER TABLE public.workspace_momentum_snapshots
      ADD CONSTRAINT workspace_momentum_snapshots_initiative_id_fkey
      FOREIGN KEY (initiative_id) REFERENCES public.workspace_initiatives(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_operational_timeline_workspace_id_fkey') THEN
    ALTER TABLE public.workspace_operational_timeline
      ADD CONSTRAINT workspace_operational_timeline_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_operational_timeline_initiative_id_fkey') THEN
    ALTER TABLE public.workspace_operational_timeline
      ADD CONSTRAINT workspace_operational_timeline_initiative_id_fkey
      FOREIGN KEY (initiative_id) REFERENCES public.workspace_initiatives(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_revocations_workspace_id_fkey') THEN
    ALTER TABLE public.authority_revocations
      ADD CONSTRAINT authority_revocations_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_user_key ON public.cache (user_id, cache_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_username_lower ON public.profiles (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_invites_pending_email ON public.workspace_invites (workspace_id, lower(email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_google_drive_tokens_workspace_provider ON public.google_drive_tokens (user_id, workspace_id, provider) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_google_drive_tokens_personal_provider ON public.google_drive_tokens (user_id, provider) WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);
CREATE INDEX IF NOT EXISTS idx_profiles_id ON public.profiles (id);
CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON public.workspaces (user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_parent_workspace_id ON public.workspaces (parent_workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_type ON public.workspaces (workspace_type);
CREATE INDEX IF NOT EXISTS idx_workspaces_global_parent ON public.workspaces (parent_workspace_id, is_global);
CREATE INDEX IF NOT EXISTS idx_workspaces_workspace_focus ON public.workspaces (workspace_focus);
CREATE INDEX IF NOT EXISTS idx_workspaces_ai_specialization ON public.workspaces (ai_specialization);
CREATE INDEX IF NOT EXISTS idx_workspaces_intelligence_preferences ON public.workspaces USING gin (intelligence_preferences);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON public.workspace_members (user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_role ON public.workspace_members (role);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id ON public.workspace_invites (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email_status_created ON public.workspace_invites (lower(email), status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status_created ON public.workspace_invites (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_user_last_message ON public.conversations (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_last_message ON public.conversations (workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_archived ON public.conversations (is_archived);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON public.messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_user_created_at ON public.messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_metadata_gin ON public.messages USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_messages_payload_gin ON public.messages USING gin (payload);

CREATE INDEX IF NOT EXISTS idx_files_user_id ON public.files (user_id);
CREATE INDEX IF NOT EXISTS idx_files_workspace_id ON public.files (workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_conversation_id ON public.files (conversation_id);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON public.files (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_metadata_gin ON public.files USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_files_file_name_fts ON public.files USING gin (to_tsvector('simple', coalesce(file_name, '')));

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents (user_id);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON public.documents (workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_file_id ON public.documents (file_id);
CREATE INDEX IF NOT EXISTS idx_documents_file_chunk ON public.documents (file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_created_at ON public.documents (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_user_workspace ON public.documents (user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_content_fts ON public.documents USING gin (to_tsvector('simple', coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_documents_metadata_gin ON public.documents USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_documents_embedding_cosine ON public.documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_id ON public.artifacts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_user_id ON public.artifacts (user_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_created_at ON public.artifacts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_pinned ON public.artifacts (workspace_id, pinned, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_metadata_gin ON public.artifacts USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON public.api_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint_status ON public.api_logs (endpoint, status);
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id ON public.api_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_automations_workspace_id ON public.automations (workspace_id);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON public.automations (enabled);
CREATE INDEX IF NOT EXISTS idx_automations_job_type ON public.automations (job_type);
CREATE INDEX IF NOT EXISTS idx_automation_logs_automation_id ON public.automation_logs (automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_workspace_id ON public.automation_logs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_started_at ON public.automation_logs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON public.jobs (created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON public.jobs (type, status);

CREATE INDEX IF NOT EXISTS idx_google_drive_tokens_user_id ON public.google_drive_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_google_drive_tokens_workspace_id ON public.google_drive_tokens (workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_presence_workspace_seen ON public.workspace_presence (workspace_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_presence_user_id ON public.workspace_presence (user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_presence_typing ON public.workspace_presence (workspace_id, typing_conversation_id, typing_until) WHERE typing_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_activity_events_workspace_created ON public.workspace_activity_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_activity_events_actor_created ON public.workspace_activity_events (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_activity_events_type ON public.workspace_activity_events (event_type);

CREATE INDEX IF NOT EXISTS idx_workspace_initiatives_workspace_id ON public.workspace_initiatives (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_initiatives_status ON public.workspace_initiatives (status);
CREATE INDEX IF NOT EXISTS idx_workspace_initiatives_workspace_status ON public.workspace_initiatives (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_initiatives_updated_at ON public.workspace_initiatives (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_intelligence_memory_workspace_type ON public.workspace_intelligence_memory (workspace_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_workspace_intelligence_memory_workspace_created ON public.workspace_intelligence_memory (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_intelligence_memory_importance ON public.workspace_intelligence_memory (workspace_id, importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_intelligence_memory_initiative ON public.workspace_intelligence_memory (initiative_id);
CREATE INDEX IF NOT EXISTS idx_workspace_intelligence_memory_resolution ON public.workspace_intelligence_memory (workspace_id, resolution_status);
CREATE INDEX IF NOT EXISTS idx_workspace_intelligence_memory_valid_until ON public.workspace_intelligence_memory (valid_until);
CREATE INDEX IF NOT EXISTS idx_workspace_intelligence_memory_structured_data ON public.workspace_intelligence_memory USING gin (structured_data);

CREATE INDEX IF NOT EXISTS idx_workspace_momentum_snapshots_workspace_time ON public.workspace_momentum_snapshots (workspace_id, snapshot_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_momentum_snapshots_initiative_time ON public.workspace_momentum_snapshots (initiative_id, snapshot_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_operational_timeline_workspace_time ON public.workspace_operational_timeline (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_operational_timeline_initiative ON public.workspace_operational_timeline (initiative_id);
CREATE INDEX IF NOT EXISTS idx_workspace_operational_timeline_event_type ON public.workspace_operational_timeline (event_type);

CREATE INDEX IF NOT EXISTS idx_authority_revocations_user_created ON public.authority_revocations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_revocations_workspace_created ON public.authority_revocations (workspace_id, created_at DESC);

INSERT INTO public.profiles (id, created_at, updated_at)
SELECT DISTINCT wm.user_id, now(), now()
FROM public.workspace_members wm
WHERE wm.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, created_at, updated_at)
SELECT DISTINCT w.user_id, now(), now()
FROM public.workspaces w
WHERE w.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  trigger_table regclass;
  trigger_name text;
BEGIN
  FOREACH trigger_table IN ARRAY ARRAY[
    'public.profiles'::regclass,
    'public.workspaces'::regclass,
    'public.workspace_members'::regclass,
    'public.workspace_invites'::regclass,
    'public.conversations'::regclass,
    'public.files'::regclass,
    'public.documents'::regclass,
    'public.artifacts'::regclass,
    'public.cache'::regclass,
    'public.automations'::regclass,
    'public.google_drive_tokens'::regclass,
    'public.workspace_presence'::regclass,
    'public.workspace_initiatives'::regclass,
    'public.workspace_intelligence_memory'::regclass
  ]
  LOOP
    trigger_name := replace(trigger_table::text, '.', '_') || '_set_updated_at';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = trigger_table
        AND tgname = trigger_name
        AND NOT tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.omnix_set_updated_at()',
        trigger_name,
        trigger_table
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_documents_vector(
  q double precision[],
  p_top_k integer,
  p_user uuid,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  file_id uuid,
  created_at timestamptz,
  workspace_id uuid,
  distance double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id,
    d.content,
    d.file_id,
    d.created_at,
    d.workspace_id,
    (d.embedding <=> q::vector(384))::double precision AS distance
  FROM public.documents d
  WHERE d.user_id = p_user
    AND d.embedding IS NOT NULL
    AND (
      p_workspace_ids IS NULL
      OR cardinality(p_workspace_ids) = 0
      OR d.workspace_id = ANY(p_workspace_ids)
    )
  ORDER BY d.embedding <=> q::vector(384)
  LIMIT greatest(coalesce(p_top_k, 8), 1);
$$;

CREATE OR REPLACE FUNCTION public.search_documents_vector(
  q double precision[],
  p_top_k integer,
  p_user uuid,
  p_workspace uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  file_id uuid,
  created_at timestamptz,
  distance double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id,
    d.content,
    d.file_id,
    d.created_at,
    (d.embedding <=> q::vector(384))::double precision AS distance
  FROM public.documents d
  WHERE d.user_id = p_user
    AND d.embedding IS NOT NULL
    AND (p_workspace IS NULL OR d.workspace_id = p_workspace)
  ORDER BY d.embedding <=> q::vector(384)
  LIMIT greatest(coalesce(p_top_k, 8), 1);
$$;

CREATE OR REPLACE FUNCTION public.search_documents_keyword(
  q text,
  p_top_k integer,
  p_user uuid,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  file_id uuid,
  created_at timestamptz,
  workspace_id uuid,
  user_id uuid,
  rank double precision,
  file_name text,
  file_metadata jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH query AS (
    SELECT plainto_tsquery('simple', coalesce(q, '')) AS tsq
  )
  SELECT
    d.id,
    d.content,
    d.file_id,
    d.created_at,
    d.workspace_id,
    d.user_id,
    ts_rank_cd(to_tsvector('simple', coalesce(d.content, '')), query.tsq)::double precision AS rank,
    f.file_name,
    f.metadata AS file_metadata
  FROM public.documents d
  CROSS JOIN query
  LEFT JOIN public.files f ON f.id = d.file_id
  WHERE d.user_id = p_user
    AND btrim(coalesce(q, '')) <> ''
    AND to_tsvector('simple', coalesce(d.content, '')) @@ query.tsq
    AND (
      p_workspace_ids IS NULL
      OR cardinality(p_workspace_ids) = 0
      OR d.workspace_id = ANY(p_workspace_ids)
    )
  ORDER BY rank DESC, d.created_at DESC
  LIMIT greatest(coalesce(p_top_k, 8), 1);
$$;

CREATE OR REPLACE FUNCTION public.search_documents_keyword(
  q text,
  p_top_k integer,
  p_user uuid,
  p_workspace uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  file_id uuid,
  created_at timestamptz,
  workspace_id uuid,
  user_id uuid,
  rank double precision,
  file_name text,
  file_metadata jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH query AS (
    SELECT plainto_tsquery('simple', coalesce(q, '')) AS tsq
  )
  SELECT
    d.id,
    d.content,
    d.file_id,
    d.created_at,
    d.workspace_id,
    d.user_id,
    ts_rank_cd(to_tsvector('simple', coalesce(d.content, '')), query.tsq)::double precision AS rank,
    f.file_name,
    f.metadata AS file_metadata
  FROM public.documents d
  CROSS JOIN query
  LEFT JOIN public.files f ON f.id = d.file_id
  WHERE d.user_id = p_user
    AND btrim(coalesce(q, '')) <> ''
    AND to_tsvector('simple', coalesce(d.content, '')) @@ query.tsq
    AND (p_workspace IS NULL OR d.workspace_id = p_workspace)
  ORDER BY rank DESC, d.created_at DESC
  LIMIT greatest(coalesce(p_top_k, 8), 1);
$$;

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(384),
  match_threshold double precision,
  match_count integer,
  filter_user_id uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id,
    d.content,
    (1 - (d.embedding <=> query_embedding))::double precision AS similarity
  FROM public.documents d
  WHERE d.user_id = filter_user_id
    AND d.embedding IS NOT NULL
    AND (1 - (d.embedding <=> query_embedding)) > coalesce(match_threshold, 0)
  ORDER BY d.embedding <=> query_embedding
  LIMIT greatest(coalesce(match_count, 8), 1);
$$;

CREATE OR REPLACE FUNCTION public.omnix_embedding_contract()
RETURNS TABLE (
  expected_dimension integer,
  embedding_type text,
  embedding_ready boolean,
  legacy_column_exists boolean,
  workspace_column_exists boolean,
  embedded_rows bigint,
  missing_embedding_rows bigint
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    384 AS expected_dimension,
    (
      SELECT format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute a
      WHERE a.attrelid = 'public.documents'::regclass
        AND a.attname = 'embedding'
        AND NOT a.attisdropped
    ) AS embedding_type,
    EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = 'public.documents'::regclass
        AND a.attname = 'embedding'
        AND format_type(a.atttypid, a.atttypmod) = 'vector(384)'
        AND NOT a.attisdropped
    ) AS embedding_ready,
    EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = 'public.documents'::regclass
        AND a.attname = 'embedding_legacy'
        AND NOT a.attisdropped
    ) AS legacy_column_exists,
    EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = 'public.documents'::regclass
        AND a.attname = 'workspace_id'
        AND NOT a.attisdropped
    ) AS workspace_column_exists,
    (SELECT count(*) FROM public.documents WHERE embedding IS NOT NULL) AS embedded_rows,
    (SELECT count(*) FROM public.documents WHERE embedding IS NULL) AS missing_embedding_rows;
END;
$$;

ALTER TABLE public.authority_revocations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'authority_revocations'
      AND policyname = 'Users can view their own authority revocations'
  ) THEN
    CREATE POLICY "Users can view their own authority revocations"
      ON public.authority_revocations
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'authority_revocations'
      AND policyname = 'Service role can insert authority revocations'
  ) THEN
    CREATE POLICY "Service role can insert authority revocations"
      ON public.authority_revocations
      FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END;
$$;

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_presence REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_activity_events REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_initiatives REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_intelligence_memory REPLICA IDENTITY FULL;
ALTER TABLE public.workspace_operational_timeline REPLICA IDENTITY FULL;
ALTER TABLE public.authority_revocations REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.omnix_add_table_to_realtime(p_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rel_schema text;
  rel_name text;
BEGIN
  SELECT n.nspname, c.relname
  INTO rel_schema, rel_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = p_table;

  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = rel_schema
      AND tablename = rel_name
  ) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', p_table);
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'Skipping realtime publication setup for %: %', p_table, SQLERRM;
END;
$$;

SELECT public.omnix_add_table_to_realtime('public.conversations'::regclass);
SELECT public.omnix_add_table_to_realtime('public.messages'::regclass);
SELECT public.omnix_add_table_to_realtime('public.workspace_presence'::regclass);
SELECT public.omnix_add_table_to_realtime('public.workspace_activity_events'::regclass);
SELECT public.omnix_add_table_to_realtime('public.workspace_initiatives'::regclass);
SELECT public.omnix_add_table_to_realtime('public.workspace_intelligence_memory'::regclass);
SELECT public.omnix_add_table_to_realtime('public.workspace_operational_timeline'::regclass);
SELECT public.omnix_add_table_to_realtime('public.authority_revocations'::regclass);

DROP FUNCTION IF EXISTS public.omnix_add_table_to_realtime(regclass);
