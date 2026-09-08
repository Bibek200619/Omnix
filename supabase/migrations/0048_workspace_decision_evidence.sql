-- Verifiable decision evidence. Candidate acceptance stores server-revalidated
-- source locators and verbatim quote snapshots atomically with the decision.

ALTER TABLE public.workspace_decisions
  ADD COLUMN IF NOT EXISTS source_evidence jsonb;

UPDATE public.workspace_decisions
SET source_evidence = '[]'::jsonb
WHERE source_evidence IS NULL;

ALTER TABLE public.workspace_decisions
  ALTER COLUMN source_evidence SET DEFAULT '[]'::jsonb,
  ALTER COLUMN source_evidence SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_decisions_source_evidence_check'
      AND conrelid = 'public.workspace_decisions'::regclass
  ) THEN
    ALTER TABLE public.workspace_decisions
      ADD CONSTRAINT workspace_decisions_source_evidence_check
      CHECK (
        CASE
          WHEN jsonb_typeof(source_evidence) = 'array' THEN jsonb_array_length(source_evidence) <= 5
          ELSE false
        END
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_workspace_decision_source_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.source_evidence IS DISTINCT FROM NEW.source_evidence THEN
    RAISE EXCEPTION 'Decision source evidence is immutable after creation.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_decisions_source_evidence_immutable ON public.workspace_decisions;
CREATE TRIGGER workspace_decisions_source_evidence_immutable
BEFORE UPDATE OF source_evidence ON public.workspace_decisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_decision_source_evidence_mutation();
