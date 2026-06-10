ALTER TABLE public.files ADD COLUMN IF NOT EXISTS page_count integer;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS extractor_used text;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS extracted_character_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS image_page_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS text_page_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'processing';
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS extraction_failure_reason text;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS ocr_used boolean NOT NULL DEFAULT false;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS ocr_character_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'files_extraction_status_check'
      AND conrelid = 'public.files'::regclass
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_extraction_status_check
      CHECK (extraction_status IN ('processing', 'searchable', 'ocr_required', 'extraction_failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_files_extraction_status ON public.files (extraction_status);
