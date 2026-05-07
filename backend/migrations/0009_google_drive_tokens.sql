-- Google Drive tokens table
CREATE TABLE IF NOT EXISTS google_drive_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid,
  provider text NOT NULL DEFAULT 'google_drive',
  access_token text,
  refresh_token text,
  scope text,
  expires_at bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_drive_tokens_user_idx ON google_drive_tokens(user_id);
CREATE INDEX IF NOT EXISTS google_drive_tokens_workspace_idx ON google_drive_tokens(workspace_id);
