ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

UPDATE public.profiles
SET welcome_email_sent_at = COALESCE(welcome_email_sent_at, created_at, now())
WHERE welcome_email_sent_at IS NULL;

COMMENT ON COLUMN public.profiles.welcome_email_sent_at
IS 'Tracks idempotent first-login welcome email delivery; existing profiles are backfilled as already welcomed.';
