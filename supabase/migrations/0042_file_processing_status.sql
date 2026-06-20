ALTER TABLE public.files ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'uploaded';
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS processing_error text;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS processing_job_id uuid;

UPDATE public.files
SET
  processing_status = CASE
    WHEN extraction_status = 'searchable' THEN 'chunked'
    WHEN extraction_status = 'processing' THEN 'processing'
    WHEN extraction_status IN ('ocr_required', 'extraction_failed') THEN 'failed'
    ELSE processing_status
  END,
  processing_error = CASE
    WHEN extraction_status IN ('ocr_required', 'extraction_failed') THEN extraction_failure_reason
    ELSE processing_error
  END
WHERE processing_status = 'uploaded'
  AND extraction_status IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'files_processing_status_check'
      AND conrelid = 'public.files'::regclass
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_processing_status_check
      CHECK (processing_status IN ('uploaded', 'queued', 'processing', 'extracted', 'chunked', 'embedded', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_files_processing_status ON public.files (processing_status);
CREATE INDEX IF NOT EXISTS idx_files_processing_job_id ON public.files (processing_job_id);
