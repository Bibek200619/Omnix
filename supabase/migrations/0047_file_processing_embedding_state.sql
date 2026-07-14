ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_processing_status_check;

ALTER TABLE public.files
  ADD CONSTRAINT files_processing_status_check
  CHECK (
    processing_status IN (
      'uploaded',
      'queued',
      'extracting',
      'chunking',
      'embedding',
      'ocr_required',
      'ocr_running',
      'searchable',
      'failed',
      'partially_searchable'
    )
  );
