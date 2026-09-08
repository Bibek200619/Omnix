-- Ordinary workspace search must not expose operational job payloads, results,
-- or internal errors. Keep the direct authenticated RPC workspace-bound while
-- limiting it to user-facing records.

CREATE OR REPLACE FUNCTION public.search_workspace_ranked(
  p_workspace_id uuid,
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id text,
  workspace_id text,
  type text,
  title text,
  preview text,
  context text,
  url text,
  channel_id text,
  message_id text,
  matched_field text,
  created_at timestamptz,
  updated_at timestamptz,
  rank real
)
LANGUAGE sql
STABLE
AS $$
WITH workspace_access AS (
  SELECT (
    (select auth.role()) = 'service_role'
    OR public.omnix_has_workspace_task_access(p_workspace_id)
  ) AS allowed
),
search_query AS (
  SELECT websearch_to_tsquery('simple', coalesce(p_query, '')) AS q
),
ranked AS (
  SELECT
    t.id::text AS id,
    t.workspace_id::text AS workspace_id,
    'task'::text AS type,
    coalesce(t.title, 'Untitled task') AS title,
    t.description AS preview,
    initcap(replace(coalesce(t.status, 'Task'), '_', ' ')) AS context,
    '/tasks?id=' || t.id::text AS url,
    NULL::text AS channel_id,
    NULL::text AS message_id,
    'full_text'::text AS matched_field,
    t.created_at,
    t.updated_at,
    ts_rank(to_tsvector('simple', coalesce(t.title, '') || ' ' || coalesce(t.description, '')), search_query.q) AS rank
  FROM public.workspace_tasks t, search_query
  WHERE t.workspace_id = p_workspace_id
    AND to_tsvector('simple', coalesce(t.title, '') || ' ' || coalesce(t.description, '')) @@ search_query.q

  UNION ALL

  SELECT
    i.id::text,
    i.workspace_id::text,
    'initiative'::text,
    coalesce(i.title, 'Untitled initiative'),
    i.description,
    initcap(replace(coalesce(i.status, 'Initiative'), '_', ' ')),
    '/initiatives?id=' || i.id::text,
    NULL::text,
    NULL::text,
    'full_text'::text,
    i.created_at,
    i.updated_at,
    ts_rank(to_tsvector('simple', coalesce(i.title, '') || ' ' || coalesce(i.description, '')), search_query.q)
  FROM public.workspace_initiatives i, search_query
  WHERE i.workspace_id = p_workspace_id
    AND to_tsvector('simple', coalesce(i.title, '') || ' ' || coalesce(i.description, '')) @@ search_query.q

  UNION ALL

  SELECT
    d.id::text,
    d.workspace_id::text,
    'decision'::text,
    coalesce(d.title, 'Untitled decision'),
    coalesce(d.decision_reason, d.description),
    initcap(replace(coalesce(d.status, 'Decision'), '_', ' ')),
    '/decisions?id=' || d.id::text,
    NULL::text,
    NULL::text,
    'full_text'::text,
    d.created_at,
    d.updated_at,
    ts_rank(to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(d.description, '') || ' ' || coalesce(d.decision_reason, '')), search_query.q)
  FROM public.workspace_decisions d, search_query
  WHERE d.workspace_id = p_workspace_id
    AND to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(d.description, '') || ' ' || coalesce(d.decision_reason, '')) @@ search_query.q

  UNION ALL

  SELECT
    f.id::text,
    f.workspace_id::text,
    'file'::text,
    coalesce(f.file_name, 'Workspace file'),
    f.file_type,
    initcap(replace(coalesce(f.processing_status, f.extraction_status, 'File'), '_', ' ')),
    '/files?id=' || f.id::text,
    NULL::text,
    NULL::text,
    'full_text'::text,
    f.created_at,
    f.updated_at,
    ts_rank(to_tsvector('simple', coalesce(f.file_name, '') || ' ' || coalesce(f.file_type, '') || ' ' || coalesce(f.processing_status, '') || ' ' || coalesce(f.extraction_status, '')), search_query.q)
  FROM public.files f, search_query
  WHERE f.workspace_id = p_workspace_id
    AND to_tsvector('simple', coalesce(f.file_name, '') || ' ' || coalesce(f.file_type, '') || ' ' || coalesce(f.processing_status, '') || ' ' || coalesce(f.extraction_status, '')) @@ search_query.q

  UNION ALL

  SELECT
    doc.id::text,
    doc.workspace_id::text,
    'document'::text,
    coalesce(doc.metadata->>'file_name', doc.metadata->>'source_name', doc.metadata->>'title', 'Document snippet'),
    doc.content,
    initcap(replace(coalesce(doc.source_type, 'Extracted document text'), '_', ' ')),
    CASE WHEN doc.file_id IS NOT NULL THEN '/files?id=' || doc.file_id::text ELSE '/files' END,
    NULL::text,
    NULL::text,
    'full_text'::text,
    doc.created_at,
    doc.updated_at,
    ts_rank(to_tsvector('simple', coalesce(doc.content, '') || ' ' || coalesce(doc.source_type, '') || ' ' || coalesce(doc.metadata::text, '')), search_query.q)
  FROM public.documents doc, search_query
  WHERE doc.workspace_id = p_workspace_id
    AND to_tsvector('simple', coalesce(doc.content, '') || ' ' || coalesce(doc.source_type, '') || ' ' || coalesce(doc.metadata::text, '')) @@ search_query.q

  UNION ALL

  SELECT
    c.id::text,
    c.workspace_id::text,
    'source'::text,
    coalesce(c.display_name, initcap(replace(coalesce(c.connector_type, 'source'), '_', ' '))),
    coalesce(c.last_error, c.connector_type),
    initcap(replace(coalesce(c.status, 'Source'), '_', ' ')),
    '/files?source=' || c.id::text,
    NULL::text,
    NULL::text,
    'full_text'::text,
    c.created_at,
    coalesce(c.updated_at, c.last_synced_at),
    ts_rank(to_tsvector('simple', coalesce(c.display_name, '') || ' ' || coalesce(c.connector_type, '') || ' ' || coalesce(c.status, '') || ' ' || coalesce(c.last_error, '')), search_query.q)
  FROM public.workspace_connectors c, search_query
  WHERE c.workspace_id = p_workspace_id
    AND to_tsvector('simple', coalesce(c.display_name, '') || ' ' || coalesce(c.connector_type, '') || ' ' || coalesce(c.status, '') || ' ' || coalesce(c.last_error, '')) @@ search_query.q

  UNION ALL

  SELECT
    a.id::text,
    a.workspace_id::text,
    'automation'::text,
    coalesce(a.name, 'Automation'),
    coalesce(a.job_type, a.schedule::text),
    CASE WHEN coalesce(a.enabled, false) THEN 'Enabled Automation' ELSE 'Disabled Automation' END,
    '/automations?id=' || a.id::text,
    NULL::text,
    NULL::text,
    'full_text'::text,
    a.created_at,
    a.updated_at,
    ts_rank(to_tsvector('simple', coalesce(a.name, '') || ' ' || coalesce(a.job_type, '') || ' ' || coalesce(a.schedule::text, '')), search_query.q)
  FROM public.automations a, search_query
  WHERE a.workspace_id = p_workspace_id
    AND to_tsvector('simple', coalesce(a.name, '') || ' ' || coalesce(a.job_type, '') || ' ' || coalesce(a.schedule::text, '')) @@ search_query.q

  UNION ALL

  SELECT
    e.id::text,
    e.workspace_id::text,
    'activity'::text,
    coalesce(e.summary, initcap(replace(coalesce(e.event_type, 'activity'), '_', ' '))),
    e.metadata::text,
    initcap(replace(coalesce(e.event_type, 'Activity'), '_', ' ')),
    '/workspace/activity?id=' || e.id::text,
    NULL::text,
    NULL::text,
    'full_text'::text,
    e.created_at,
    e.created_at,
    ts_rank(to_tsvector('simple', coalesce(e.event_type, '') || ' ' || coalesce(e.summary, '') || ' ' || coalesce(e.metadata::text, '')), search_query.q)
  FROM public.workspace_activity_events e, search_query
  WHERE e.workspace_id = p_workspace_id
    AND to_tsvector('simple', coalesce(e.event_type, '') || ' ' || coalesce(e.summary, '') || ' ' || coalesce(e.metadata::text, '')) @@ search_query.q
)
SELECT ranked.*
FROM ranked, workspace_access
WHERE workspace_access.allowed
ORDER BY rank DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
OFFSET greatest(0, coalesce(p_offset, 0));
$$;

REVOKE ALL ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) TO service_role;
