-- Workspace invitations and memberships are exposed through authorized backend
-- routes. Browser-facing Data API roles must not query or mutate them directly.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
    public.workspace_invites,
    public.workspace_members
FROM PUBLIC;

REVOKE ALL PRIVILEGES ON TABLE
    public.workspace_invites,
    public.workspace_members
FROM anon;

REVOKE ALL PRIVILEGES ON TABLE
    public.workspace_invites,
    public.workspace_members
FROM authenticated;

GRANT ALL PRIVILEGES ON TABLE
    public.workspace_invites,
    public.workspace_members
TO service_role;

COMMIT;
