-- Create automations table and logs
CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid,
  name text,
  job_type text NOT NULL,
  schedule text,
  interval_seconds int,
  enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automations_workspace_idx ON automations(workspace_id);

CREATE TABLE IF NOT EXISTS automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid,
  workspace_id uuid,
  status text,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  result_artifact_id uuid,
  log text
);

CREATE INDEX IF NOT EXISTS automation_logs_automation_idx ON automation_logs(automation_id);
