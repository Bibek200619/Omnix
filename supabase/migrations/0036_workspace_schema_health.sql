-- Workspace platform schema-health metadata RPC.
-- The backend compares this metadata against Omnix workspace expectations.

DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connectors_workspace_id_fkey') THEN
      ALTER TABLE public.workspace_connectors
        ADD CONSTRAINT workspace_connectors_workspace_id_fkey
        FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connectors_user_id_auth_users_fkey') THEN
      ALTER TABLE public.workspace_connectors
        ADD CONSTRAINT workspace_connectors_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connectors_job_id_fkey') THEN
      ALTER TABLE public.workspace_connectors
        ADD CONSTRAINT workspace_connectors_job_id_fkey
        FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connectors_source_file_id_fkey') THEN
      ALTER TABLE public.workspace_connectors
        ADD CONSTRAINT workspace_connectors_source_file_id_fkey
        FOREIGN KEY (source_file_id) REFERENCES public.files(id) ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_decisions_source_message_id_fkey') THEN
      ALTER TABLE public.workspace_decisions
        ADD CONSTRAINT workspace_decisions_source_message_id_fkey
        FOREIGN KEY (source_message_id) REFERENCES public.workspace_channel_messages(id) ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_decisions_source_channel_id_fkey') THEN
      ALTER TABLE public.workspace_decisions
        ADD CONSTRAINT workspace_decisions_source_channel_id_fkey
        FOREIGN KEY (source_channel_id) REFERENCES public.workspace_channels(id) ON DELETE SET NULL NOT VALID;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    RAISE NOTICE 'Skipping optional workspace platform foreign keys because a referenced table is unavailable: %', SQLERRM;
  END;
END;
$$;

ALTER TABLE public.workspace_connectors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read connectors" ON public.workspace_connectors;
CREATE POLICY "Workspace members can read connectors"
  ON public.workspace_connectors FOR SELECT TO authenticated
  USING (public.omnix_has_workspace_task_access(workspace_id));

CREATE OR REPLACE FUNCTION public.omnix_workspace_schema_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
WITH required(table_name) AS (
  VALUES
    ('workspace_channels'),
    ('workspace_channel_members'),
    ('workspace_channel_messages'),
    ('workspace_tasks'),
    ('workspace_initiatives'),
    ('workspace_initiative_channels'),
    ('workspace_connectors'),
    ('workspace_decisions'),
    ('workspace_decision_tasks'),
    ('workspace_mentions')
),
table_meta AS (
  SELECT
    required.table_name,
    cls.oid,
    cls.relrowsecurity AS rls_enabled,
    cls.relreplident AS replica_identity
  FROM required
  LEFT JOIN pg_class cls
    ON cls.relname = required.table_name
   AND cls.relnamespace = 'public'::regnamespace
   AND cls.relkind IN ('r', 'p')
),
column_meta AS (
  SELECT
    cols.table_name,
    jsonb_agg(cols.column_name ORDER BY cols.ordinal_position) AS columns
  FROM information_schema.columns AS cols
  WHERE cols.table_schema = 'public'
    AND cols.table_name IN (SELECT required.table_name FROM required)
  GROUP BY cols.table_name
),
foreign_key_meta AS (
  SELECT
    rel.relname AS table_name,
    jsonb_agg(
      jsonb_build_object(
        'name', con.conname,
        'columns', local_columns.columns,
        'references_table', referenced.relname,
        'references_columns', referenced_columns.columns,
        'on_delete', con.confdeltype,
        'validated', con.convalidated
      )
      ORDER BY con.conname
    ) AS foreign_keys
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace rel_namespace ON rel_namespace.oid = rel.relnamespace
  JOIN pg_class referenced ON referenced.oid = con.confrelid
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(att.attname ORDER BY keys.ordinality) AS columns
    FROM unnest(con.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = keys.attnum
  ) local_columns
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(att.attname ORDER BY keys.ordinality) AS columns
    FROM unnest(con.confkey) WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_attribute att
      ON att.attrelid = con.confrelid
     AND att.attnum = keys.attnum
  ) referenced_columns
  WHERE con.contype = 'f'
    AND rel_namespace.nspname = 'public'
    AND rel.relname IN (SELECT required.table_name FROM required)
  GROUP BY rel.relname
),
policy_meta AS (
  SELECT
    policies.tablename AS table_name,
    jsonb_agg(
      jsonb_build_object(
        'name', policies.policyname,
        'command', policies.cmd,
        'roles', policies.roles,
        'qual', policies.qual
      )
      ORDER BY policies.policyname
    ) AS policies
  FROM pg_policies policies
  WHERE policies.schemaname = 'public'
    AND policies.tablename IN (SELECT required.table_name FROM required)
  GROUP BY policies.tablename
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'tables', COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', table_meta.table_name,
        'exists', table_meta.oid IS NOT NULL,
        'rls_enabled', COALESCE(table_meta.rls_enabled, false),
        'replica_identity', table_meta.replica_identity,
        'columns', COALESCE(column_meta.columns, '[]'::jsonb),
        'foreign_keys', COALESCE(foreign_key_meta.foreign_keys, '[]'::jsonb),
        'policies', COALESCE(policy_meta.policies, '[]'::jsonb)
      )
      ORDER BY table_meta.table_name
    ),
    '[]'::jsonb
  )
)
FROM table_meta
LEFT JOIN column_meta ON column_meta.table_name = table_meta.table_name
LEFT JOIN foreign_key_meta ON foreign_key_meta.table_name = table_meta.table_name
LEFT JOIN policy_meta ON policy_meta.table_name = table_meta.table_name;
$$;

REVOKE ALL ON FUNCTION public.omnix_workspace_schema_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omnix_workspace_schema_health() TO authenticated, service_role;
