-- Migration: Persist assistant response metadata on public.messages.
-- Idempotent and safe to run repeatedly.

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_messages_payload
ON public.messages USING gin (payload);
