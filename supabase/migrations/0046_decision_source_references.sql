-- Add generic source references for decisions accepted from candidate evidence.
-- Existing source_message_id/source_channel_id columns remain for direct message conversions.

ALTER TABLE public.workspace_decisions
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text;

UPDATE public.workspace_decisions
SET source_type = 'conversation_message',
    source_id = source_message_id::text
WHERE source_type IS NULL
  AND source_message_id IS NOT NULL;

UPDATE public.workspace_decisions
SET source_type = 'conversation',
    source_id = source_channel_id::text
WHERE source_type IS NULL
  AND source_channel_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_decisions_source_reference_check'
      AND conrelid = 'public.workspace_decisions'::regclass
  ) THEN
    ALTER TABLE public.workspace_decisions
      ADD CONSTRAINT workspace_decisions_source_reference_check
      CHECK (
        (source_type IS NULL AND source_id IS NULL)
        OR (
          source_type IN ('conversation', 'conversation_message', 'document')
          AND char_length(trim(source_id)) BETWEEN 1 AND 160
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspace_decisions_source_reference
  ON public.workspace_decisions(workspace_id, source_type, source_id)
  WHERE source_type IS NOT NULL;
