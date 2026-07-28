-- Durable file lifecycle state.
--
-- Physical storage cannot participate in a Postgres transaction, so file-row
-- changes record immutable object versions and durable cleanup work in the
-- same transaction. The worker performs the physical operation later and
-- rechecks active references immediately before deletion.

BEGIN;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_lifecycle_status_check;

ALTER TABLE public.files
  ADD CONSTRAINT files_lifecycle_status_check
  CHECK (lifecycle_status IN ('active', 'retention_pending'));

CREATE INDEX IF NOT EXISTS idx_files_retention_due
ON public.files (retention_expires_at, id)
WHERE retention_expires_at IS NOT NULL
  AND lifecycle_status = 'active';

CREATE TABLE IF NOT EXISTS public.file_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid,
  original_user_id uuid,
  original_workspace_id uuid,
  version_number integer NOT NULL,
  file_name text,
  file_type text,
  size_bytes bigint,
  content_hash text,
  storage_backend text NOT NULL,
  storage_path text NOT NULL,
  record_kind text NOT NULL DEFAULT 'registered',
  lifecycle_status text NOT NULL DEFAULT 'active',
  cleanup_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleanup_requested_at timestamptz,
  cleaned_at timestamptz,
  CONSTRAINT file_versions_version_number_check
    CHECK (version_number > 0),
  CONSTRAINT file_versions_storage_backend_check
    CHECK (storage_backend IN ('local', 'supabase')),
  CONSTRAINT file_versions_record_kind_check
    CHECK (record_kind IN ('registered', 'orphan')),
  CONSTRAINT file_versions_lifecycle_status_check
    CHECK (lifecycle_status IN ('active', 'pending_delete', 'deleted', 'missing', 'retained')),
  CONSTRAINT file_versions_file_version_unique
    UNIQUE (file_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_versions_one_active_per_file
ON public.file_versions (file_id)
WHERE file_id IS NOT NULL
  AND lifecycle_status = 'active';

CREATE INDEX IF NOT EXISTS idx_file_versions_file_history
ON public.file_versions (file_id, version_number DESC)
WHERE file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_file_versions_storage_lifecycle
ON public.file_versions (storage_path, lifecycle_status);

ALTER TABLE public.file_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.file_versions FROM PUBLIC;
REVOKE ALL ON TABLE public.file_versions FROM anon;
REVOKE ALL ON TABLE public.file_versions FROM authenticated;
GRANT ALL ON TABLE public.file_versions TO service_role;

-- Jobs are a backend implementation detail. RLS already denies browser rows,
-- and these explicit revokes remove unnecessary Data API table privileges.
REVOKE ALL ON TABLE public.jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.jobs FROM anon;
REVOKE ALL ON TABLE public.jobs FROM authenticated;
GRANT ALL ON TABLE public.jobs TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_file_cleanup_key
ON public.jobs ((payload ->> 'cleanup_key'))
WHERE type = 'cleanup_file_storage'
  AND status IN ('queued', 'processing')
  AND payload ? 'cleanup_key';

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_file_expiry
ON public.jobs ((payload ->> 'file_id'))
WHERE type = 'expire_file'
  AND status IN ('queued', 'processing')
  AND payload ? 'file_id';

CREATE OR REPLACE FUNCTION public.omnix_enqueue_file_version_cleanup(
  p_file_version_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  queued_job_id uuid;
  cleanup_key text;
BEGIN
  SELECT encode(extensions.digest(storage_path, 'sha256'), 'hex')
  INTO cleanup_key
  FROM public.file_versions
  WHERE id = p_file_version_id;

  IF cleanup_key IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.file_versions
  SET lifecycle_status = 'pending_delete',
      cleanup_reason = left(coalesce(nullif(btrim(p_reason), ''), 'unreferenced'), 80),
      cleanup_requested_at = coalesce(cleanup_requested_at, now()),
      cleaned_at = NULL
  WHERE id = p_file_version_id
    AND lifecycle_status IN ('active', 'pending_delete');

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.jobs (id, type, status, payload, progress, created_at)
  VALUES (
    gen_random_uuid(),
    'cleanup_file_storage',
    'queued',
    jsonb_build_object(
      'file_version_id',
      p_file_version_id,
      'cleanup_key',
      cleanup_key
    ),
    0,
    now()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO queued_job_id;

  IF queued_job_id IS NULL THEN
    SELECT id
    INTO queued_job_id
    FROM public.jobs
    WHERE type = 'cleanup_file_storage'
      AND status IN ('queued', 'processing')
      AND payload ->> 'cleanup_key' = cleanup_key
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  RETURN queued_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.omnix_enqueue_file_version_cleanup(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omnix_enqueue_file_version_cleanup(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.omnix_enqueue_file_version_cleanup(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.omnix_enqueue_file_version_cleanup(uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.omnix_enqueue_file_version_cleanup(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.omnix_file_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW.id,
    NEW.file_id,
    NEW.original_user_id,
    NEW.original_workspace_id,
    NEW.version_number,
    NEW.file_name,
    NEW.file_type,
    NEW.size_bytes,
    NEW.content_hash,
    NEW.storage_backend,
    NEW.storage_path,
    NEW.record_kind,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.file_id,
    OLD.original_user_id,
    OLD.original_workspace_id,
    OLD.version_number,
    OLD.file_name,
    OLD.file_type,
    OLD.size_bytes,
    OLD.content_hash,
    OLD.storage_backend,
    OLD.storage_path,
    OLD.record_kind,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'file version identity is immutable'
      USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omnix_file_versions_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omnix_file_versions_immutable() FROM anon;
REVOKE ALL ON FUNCTION public.omnix_file_versions_immutable() FROM authenticated;
REVOKE ALL ON FUNCTION public.omnix_file_versions_immutable() FROM service_role;

DROP TRIGGER IF EXISTS file_versions_immutable_identity ON public.file_versions;
CREATE TRIGGER file_versions_immutable_identity
BEFORE UPDATE ON public.file_versions
FOR EACH ROW
EXECUTE FUNCTION public.omnix_file_versions_immutable();

-- Backfill first so the change trigger only handles future writes.
INSERT INTO public.file_versions (
  file_id,
  original_user_id,
  original_workspace_id,
  version_number,
  file_name,
  file_type,
  size_bytes,
  content_hash,
  storage_backend,
  storage_path,
  record_kind,
  lifecycle_status,
  created_at
)
SELECT
  f.id,
  f.user_id,
  f.workspace_id,
  1,
  f.file_name,
  f.file_type,
  f.size_bytes,
  f.content_hash,
  coalesce(
    f.storage_backend,
    CASE WHEN f.storage_path LIKE 'supabase://%' THEN 'supabase' ELSE 'local' END
  ),
  f.storage_path,
  'registered',
  'active',
  coalesce(f.created_at, now())
FROM public.files AS f
WHERE f.storage_path IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.file_versions AS existing
    WHERE existing.file_id = f.id
  );

CREATE OR REPLACE FUNCTION public.omnix_track_file_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior_version_id uuid;
  next_version_number integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT id
    INTO prior_version_id
    FROM public.file_versions
    WHERE file_id = OLD.id
      AND lifecycle_status = 'active'
    ORDER BY version_number DESC
    LIMIT 1
    FOR UPDATE;

    IF prior_version_id IS NOT NULL THEN
      PERFORM public.omnix_enqueue_file_version_cleanup(prior_version_id, 'file_deleted');
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.storage_path IS NOT DISTINCT FROM NEW.storage_path THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.storage_path IS NOT NULL THEN
    SELECT id
    INTO prior_version_id
    FROM public.file_versions
    WHERE file_id = OLD.id
      AND lifecycle_status = 'active'
    ORDER BY version_number DESC
    LIMIT 1
    FOR UPDATE;

    IF prior_version_id IS NOT NULL THEN
      PERFORM public.omnix_enqueue_file_version_cleanup(prior_version_id, 'storage_replaced');
    END IF;
  END IF;

  IF NEW.storage_path IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(max(version_number), 0) + 1
  INTO next_version_number
  FROM public.file_versions
  WHERE file_id = NEW.id;

  INSERT INTO public.file_versions (
    file_id,
    original_user_id,
    original_workspace_id,
    version_number,
    file_name,
    file_type,
    size_bytes,
    content_hash,
    storage_backend,
    storage_path,
    record_kind,
    lifecycle_status,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.user_id,
    NEW.workspace_id,
    next_version_number,
    NEW.file_name,
    NEW.file_type,
    NEW.size_bytes,
    NEW.content_hash,
    coalesce(
      NEW.storage_backend,
      CASE WHEN NEW.storage_path LIKE 'supabase://%' THEN 'supabase' ELSE 'local' END
    ),
    NEW.storage_path,
    'registered',
    'active',
    now()
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omnix_track_file_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omnix_track_file_lifecycle() FROM anon;
REVOKE ALL ON FUNCTION public.omnix_track_file_lifecycle() FROM authenticated;
REVOKE ALL ON FUNCTION public.omnix_track_file_lifecycle() FROM service_role;

DROP TRIGGER IF EXISTS files_track_storage_lifecycle ON public.files;
CREATE TRIGGER files_track_storage_lifecycle
AFTER INSERT OR UPDATE OF storage_path OR DELETE ON public.files
FOR EACH ROW
EXECUTE FUNCTION public.omnix_track_file_lifecycle();

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
    WHERE f.lifecycle_status = 'active'
      AND f.retention_expires_at IS NOT NULL
      AND f.retention_expires_at <= now()
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

CREATE OR REPLACE FUNCTION public.omnix_enqueue_orphan_file_cleanup(
  p_storage_path text,
  p_storage_backend text DEFAULT NULL
)
RETURNS TABLE(file_version_id uuid, job_id uuid, disposition text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  normalized_path text := nullif(btrim(p_storage_path), '');
  normalized_backend text;
  pending_version_id uuid;
  queued_job_id uuid;
BEGIN
  IF normalized_path IS NULL THEN
    RAISE EXCEPTION 'storage path is required'
      USING ERRCODE = '22023';
  END IF;

  normalized_backend := coalesce(
    nullif(btrim(p_storage_backend), ''),
    CASE WHEN normalized_path LIKE 'supabase://%' THEN 'supabase' ELSE 'local' END
  );
  IF normalized_backend NOT IN ('local', 'supabase') THEN
    RAISE EXCEPTION 'unsupported storage backend'
      USING ERRCODE = '22023';
  END IF;

  -- Multiple worker replicas can scan the same path. A transaction-scoped
  -- advisory lock serializes only that path, so one orphan record/job wins.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_path, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.files
    WHERE storage_path = normalized_path
  ) OR EXISTS (
    SELECT 1
    FROM public.file_versions
    WHERE storage_path = normalized_path
      AND lifecycle_status = 'active'
  ) THEN
    UPDATE public.file_versions
    SET lifecycle_status = 'retained',
        cleanup_reason = 'active_reference',
        cleaned_at = now()
    WHERE storage_path = normalized_path
      AND lifecycle_status = 'pending_delete';

    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'referenced'::text;
    RETURN;
  END IF;

  SELECT id
  INTO pending_version_id
  FROM public.file_versions
  WHERE storage_path = normalized_path
    AND lifecycle_status = 'pending_delete'
  ORDER BY cleanup_requested_at ASC NULLS LAST, created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF pending_version_id IS NULL THEN
    INSERT INTO public.file_versions (
      file_id,
      version_number,
      storage_backend,
      storage_path,
      record_kind,
      lifecycle_status,
      cleanup_reason,
      cleanup_requested_at
    )
    VALUES (
      NULL,
      1,
      normalized_backend,
      normalized_path,
      'orphan',
      'pending_delete',
      'orphan_reconciliation',
      now()
    )
    RETURNING id INTO pending_version_id;
  END IF;

  queued_job_id := public.omnix_enqueue_file_version_cleanup(
    pending_version_id,
    'orphan_reconciliation'
  );

  RETURN QUERY
  SELECT pending_version_id, queued_job_id, 'queued'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.omnix_enqueue_orphan_file_cleanup(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omnix_enqueue_orphan_file_cleanup(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omnix_enqueue_orphan_file_cleanup(text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.omnix_enqueue_orphan_file_cleanup(text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.omnix_enqueue_orphan_file_cleanup(text, text) TO service_role;

COMMIT;
