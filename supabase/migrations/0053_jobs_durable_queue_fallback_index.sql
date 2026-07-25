-- Workers poll this durable queue path when Redis is unavailable or misses a wake-up.
-- Keep the index small by retaining only live queued rows and matching the exact
-- queue marker / oldest-first ordering used by the fallback selector.
CREATE INDEX IF NOT EXISTS idx_jobs_queued_queue_created_at
ON public.jobs ((payload->>'_queue'), created_at ASC)
WHERE status = 'queued';
