ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS ingestion_version timestamptz;
