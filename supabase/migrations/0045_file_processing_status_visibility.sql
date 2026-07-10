ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_processing_status_check;

UPDATE public.files
SET processing_status = CASE
  WHEN processing_status = 'processing' THEN 'extracting'
  WHEN processing_status IN ('extracted', 'chunked', 'embedded')
    AND COALESCE(metadata->>'text_chunks_truncated', 'false') = 'true'
    THEN 'partially_searchable'
  WHEN processing_status IN ('extracted', 'chunked', 'embedded') THEN 'searchable'
  ELSE processing_status
END
WHERE processing_status IN ('processing', 'extracted', 'chunked', 'embedded');

ALTER TABLE public.files
  ADD CONSTRAINT files_processing_status_check
  CHECK (
    processing_status IN (
      'uploaded',
      'queued',
      'extracting',
      'ocr_required',
      'ocr_running',
      'searchable',
      'failed',
      'partially_searchable'
    )
  );
