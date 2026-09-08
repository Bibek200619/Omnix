-- The linked database retained an explicit anon grant on this helper despite
-- the historical PUBLIC revoke.  Keep it callable only from authenticated
-- policies and trusted server-side clients.
REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.omnix_has_workspace_task_access(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.omnix_has_workspace_task_access(uuid) TO authenticated, service_role;

-- Recreate the SELECT policies with init-plan-friendly auth expressions.
DROP POLICY IF EXISTS "Users can read their own private documents" ON public.documents;
CREATE POLICY "Users can read their own private documents"
    ON public.documents
    FOR SELECT
    TO authenticated
    USING (workspace_id IS NULL AND (select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Workspace members can read workspace documents" ON public.documents;
CREATE POLICY "Workspace members can read workspace documents"
    ON public.documents
    FOR SELECT
    TO authenticated
    USING (
        workspace_id IS NOT NULL
        AND (select public.omnix_has_workspace_task_access(workspace_id))
    );

DROP POLICY IF EXISTS "Users can read their own private files" ON public.files;
CREATE POLICY "Users can read their own private files"
    ON public.files
    FOR SELECT
    TO authenticated
    USING (workspace_id IS NULL AND (select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Workspace members can read workspace files" ON public.files;
CREATE POLICY "Workspace members can read workspace files"
    ON public.files
    FOR SELECT
    TO authenticated
    USING (
        workspace_id IS NOT NULL
        AND (select public.omnix_has_workspace_task_access(workspace_id))
    );
