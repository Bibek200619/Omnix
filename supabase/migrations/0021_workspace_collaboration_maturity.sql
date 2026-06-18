-- Migration: real-time collaboration maturity primitives.
-- Presence is heartbeat-backed for now and can later be paired with websocket sessions.

CREATE TABLE IF NOT EXISTS workspace_presence (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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
  CONSTRAINT workspace_presence_pkey PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_presence_status_check CHECK (status IN ('online', 'idle', 'offline'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_presence_workspace_seen
ON workspace_presence(workspace_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_presence_typing
ON workspace_presence(workspace_id, typing_until DESC)
WHERE typing_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid,
  event_type text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_workspace_created
ON workspace_activity_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_actor_created
ON workspace_activity_events(actor_user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_presence_user_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE workspace_presence
      ADD CONSTRAINT workspace_presence_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping workspace_presence.user_id FK creation - auth.users not available.';
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_presence_typing_conversation_fkey'
  ) THEN
    ALTER TABLE workspace_presence
    ADD CONSTRAINT workspace_presence_typing_conversation_fkey
    FOREIGN KEY (typing_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_activity_actor_user_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE workspace_activity_events
      ADD CONSTRAINT workspace_activity_actor_user_id_fkey
      FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      RAISE NOTICE 'Skipping workspace_activity_events.actor_user_id FK creation - auth.users not available.';
    END;
  END IF;
END$$;
