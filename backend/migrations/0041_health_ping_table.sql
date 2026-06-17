CREATE TABLE IF NOT EXISTS public.system_health_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_check_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_system_health_pings_health_check_at
  ON public.system_health_pings(health_check_at DESC);
