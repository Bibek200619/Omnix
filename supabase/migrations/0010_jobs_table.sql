-- Jobs table for background processing
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  payload jsonb,
  progress int DEFAULT 0,
  attempts int DEFAULT 0,
  error text,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at);
