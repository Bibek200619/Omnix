-- Retention jobs use bounded worker retries. If a job is dead-lettered during
-- a storage outage, keep the file pending and let periodic maintenance create
-- a fresh durable attempt once no queued/processing attempt remains.

BEGIN;

CREATE OR REPLACE FUNCTION public.omnix_enqueue_expired_file_jobs(
  p_limit integer DEFAULT 100
)
RETURNS TABLE(file_id uuid, job_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH due_files AS (
    SELECT f.id
    FROM public.files AS f
    WHERE f.lifecycle_status IN ('active', 'retention_pending')
      AND f.retention_expires_at IS NOT NULL
      AND f.retention_expires_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.jobs AS active_job
        WHERE active_job.type = 'expire_file'
          AND active_job.status IN ('queued', 'processing')
          AND active_job.payload ->> 'file_id' = f.id::text
      )
    ORDER BY f.retention_expires_at ASC, f.id ASC
    LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
    FOR UPDATE SKIP LOCKED
  ),
  marked AS (
    UPDATE public.files AS f
    SET lifecycle_status = 'retention_pending'
    FROM due_files
    WHERE f.id = due_files.id
    RETURNING f.id
  ),
  inserted AS (
    INSERT INTO public.jobs (id, type, status, payload, progress, created_at)
    SELECT
      gen_random_uuid(),
      'expire_file',
      'queued',
      jsonb_build_object('file_id', marked.id),
      0,
      now()
    FROM marked
    ON CONFLICT DO NOTHING
    RETURNING id, payload
  )
  SELECT (inserted.payload ->> 'file_id')::uuid, inserted.id
  FROM inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.omnix_enqueue_expired_file_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omnix_enqueue_expired_file_jobs(integer) FROM anon;
REVOKE ALL ON FUNCTION public.omnix_enqueue_expired_file_jobs(integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.omnix_enqueue_expired_file_jobs(integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.omnix_enqueue_expired_file_jobs(integer) TO service_role;

COMMIT;
