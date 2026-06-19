-- Migration: Operational Continuity and Initiative Intelligence

-- 1. Workspace Initiatives (Phase 2)
CREATE TABLE IF NOT EXISTS workspace_initiatives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'active', -- 'active', 'paused', 'completed'
    momentum_score float NOT NULL DEFAULT 1.0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspace_initiatives_status_check CHECK (status IN ('active', 'paused', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_initiatives_workspace_id ON workspace_initiatives(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_initiatives_status ON workspace_initiatives(status);

-- 2. Continuity Memory Engine (Phase 3)
-- Extend workspace_intelligence_memory to link to initiatives and track resolution state.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspace_intelligence_memory' AND column_name='initiative_id'
  ) THEN
    ALTER TABLE workspace_intelligence_memory ADD COLUMN initiative_id uuid REFERENCES workspace_initiatives(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspace_intelligence_memory' AND column_name='resolution_status'
  ) THEN
    -- e.g. 'unresolved', 'resolved', 'pending_collaboration', 'blocked'
    ALTER TABLE workspace_intelligence_memory ADD COLUMN resolution_status text;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_ws_intel_memory_initiative ON workspace_intelligence_memory(initiative_id);
CREATE INDEX IF NOT EXISTS idx_ws_intel_memory_resolution ON workspace_intelligence_memory(resolution_status);

-- 3. Operational Momentum Engine (Phase 1)
CREATE TABLE IF NOT EXISTS workspace_momentum_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    initiative_id uuid REFERENCES workspace_initiatives(id) ON DELETE CASCADE,
    score float NOT NULL DEFAULT 0.0,
    active_collaborators integer NOT NULL DEFAULT 0,
    synthesis_events integer NOT NULL DEFAULT 0,
    unresolved_threads integer NOT NULL DEFAULT 0,
    snapshot_timestamp timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_workspace_momentum_workspace_time ON workspace_momentum_snapshots(workspace_id, snapshot_timestamp DESC);

-- 4. Operational Timeline System (Phase 5)
CREATE TABLE IF NOT EXISTS workspace_operational_timeline (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    initiative_id uuid REFERENCES workspace_initiatives(id) ON DELETE CASCADE,
    event_type text NOT NULL, -- e.g. 'initiative_started', 'momentum_spike', 'decision_made', 'synthesis', 'slowdown'
    summary text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_timeline_workspace_time ON workspace_operational_timeline(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_timeline_initiative ON workspace_operational_timeline(initiative_id);

-- Enable realtime for new tables
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
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_operational_timeline'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_operational_timeline;
  END IF;
END$$;
