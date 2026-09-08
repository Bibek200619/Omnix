-- Activity events are emitted by trusted backend workers.  Authenticated
-- clients only need SELECT for the membership-scoped realtime feed.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.workspace_activity_events FROM authenticated;
GRANT SELECT ON TABLE public.workspace_activity_events TO authenticated;

COMMIT;
