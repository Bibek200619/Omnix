-- Make retries of the same authenticated decision-creation attempt durable
-- without conflating decisions created by another user or workspace.
ALTER TABLE public.workspace_decisions
  ADD COLUMN IF NOT EXISTS client_nonce text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_decisions_client_nonce
  ON public.workspace_decisions(workspace_id, created_by, client_nonce)
  WHERE client_nonce IS NOT NULL;
