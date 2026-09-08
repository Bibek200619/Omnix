-- Activity events are read by the backend and by authenticated realtime
-- subscribers.  Anonymous callers must not be able to enumerate a tenant's
-- activity, and clients must not forge audit events directly.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.workspace_activity_events FROM anon;
REVOKE INSERT ON TABLE public.workspace_activity_events FROM authenticated;
GRANT SELECT ON TABLE public.workspace_activity_events TO authenticated;

DROP POLICY IF EXISTS "Scoped Activity Visibility" ON public.workspace_activity_events;
DROP POLICY IF EXISTS "Workspace members can create activity events" ON public.workspace_activity_events;

CREATE POLICY "Workspace members can view activity"
    ON public.workspace_activity_events
    FOR SELECT
    TO authenticated
    USING (
        (select public.omnix_has_workspace_task_access(workspace_id))
    );

COMMIT;
