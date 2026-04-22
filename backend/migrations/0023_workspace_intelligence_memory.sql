-- Unified Workspace Intelligence Memory
-- Stores synthesized summaries, cross-team intelligence links, and organizational memory.

CREATE TABLE IF NOT EXISTS workspace_intelligence_memory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    memory_type text NOT NULL, -- 'synthesis', 'summary', 'link', 'insight'
    content text NOT NULL,
    structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    importance_score float NOT NULL DEFAULT 0.5,
    valid_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ws_intel_memory_workspace_type ON workspace_intelligence_memory(workspace_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_ws_intel_memory_importance ON workspace_intelligence_memory(importance_score DESC);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE workspace_intelligence_memory;
