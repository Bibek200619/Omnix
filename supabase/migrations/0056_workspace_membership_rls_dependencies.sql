-- Authenticated RLS policies on collaboration tables inspect workspace_members.
-- Restore read-only access through a tenant-scoped policy while keeping every
-- membership mutation and all direct invite access backend-only.

BEGIN;

ALTER FUNCTION public.omnix_has_workspace_task_access(uuid)
SET search_path = '';

REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.omnix_has_workspace_task_access(uuid)
TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON TABLE public.workspace_members FROM authenticated;
GRANT SELECT ON TABLE public.workspace_members TO authenticated;

DROP POLICY IF EXISTS "Scoped Member Visibility" ON public.workspace_members;
CREATE POLICY "Scoped Member Visibility"
    ON public.workspace_members
    FOR SELECT
    TO authenticated
    USING (
        (select public.omnix_has_workspace_task_access(workspace_id))
    );

COMMIT;
