ALTER TABLE public.files
ADD COLUMN IF NOT EXISTS storage_backend text;

UPDATE public.files
SET storage_backend = 'local'
WHERE storage_backend IS NULL
  AND storage_path IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'files_storage_backend_check'
  ) THEN
    ALTER TABLE public.files
    ADD CONSTRAINT files_storage_backend_check
    CHECK (storage_backend IS NULL OR storage_backend IN ('supabase', 'local'));
  END IF;
END $$;
