ALTER TABLE public.automations
ADD COLUMN IF NOT EXISTS last_run_at timestamptz;
