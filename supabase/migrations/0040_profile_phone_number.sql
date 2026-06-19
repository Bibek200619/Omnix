-- Migration: Add phone number support to user profiles.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_number text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_phone_number_format_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_phone_number_format_check
  CHECK (phone_number IS NULL OR phone_number ~ '^\+?[1-9][0-9]{6,19}$');

CREATE INDEX IF NOT EXISTS idx_profiles_phone_number
ON public.profiles(phone_number)
WHERE phone_number IS NOT NULL;

COMMIT;
