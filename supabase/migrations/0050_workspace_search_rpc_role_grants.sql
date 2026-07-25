-- The linked database has an explicit anon grant that survives a PUBLIC revoke.
-- Keep ranked workspace search callable only by authenticated users and backend
-- service-role operations.

REVOKE ALL ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_workspace_ranked(uuid, text, integer, integer) TO service_role;
