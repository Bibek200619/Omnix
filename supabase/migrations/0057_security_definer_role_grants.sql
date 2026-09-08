-- Public SECURITY DEFINER functions must use explicit, least-privilege execute
-- grants. Access predicates are required by authenticated RLS policies, while
-- schema-health metadata is backend-only.

BEGIN;

ALTER FUNCTION public.omnix_has_workspace_conversation_access(uuid)
SET search_path = '';
ALTER FUNCTION public.omnix_can_read_workspace_channel(uuid)
SET search_path = '';
ALTER FUNCTION public.omnix_has_workspace_decision_access(uuid)
SET search_path = '';
ALTER FUNCTION public.omnix_has_workspace_task_access(uuid)
SET search_path = '';
ALTER FUNCTION public.omnix_workspace_schema_health()
SET search_path = '';

REVOKE ALL ON FUNCTION
    public.omnix_has_workspace_conversation_access(uuid),
    public.omnix_can_read_workspace_channel(uuid),
    public.omnix_has_workspace_decision_access(uuid),
    public.omnix_has_workspace_task_access(uuid),
    public.omnix_workspace_schema_health()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
    public.omnix_has_workspace_conversation_access(uuid),
    public.omnix_can_read_workspace_channel(uuid),
    public.omnix_has_workspace_decision_access(uuid),
    public.omnix_has_workspace_task_access(uuid)
TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.omnix_workspace_schema_health()
TO service_role;

COMMIT;
