-- Authority revocations drive client-side trust invalidation. Only the trusted
-- backend may publish them; authenticated clients may receive only their own.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.authority_revocations
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.authority_revocations
TO authenticated;

GRANT SELECT, INSERT ON TABLE public.authority_revocations
TO service_role;

DROP POLICY IF EXISTS "Service role can insert authority revocations"
ON public.authority_revocations;

DROP POLICY IF EXISTS "Users can view their own authority revocations"
ON public.authority_revocations;
CREATE POLICY "Users can view their own authority revocations"
    ON public.authority_revocations
    FOR SELECT
    TO authenticated
    USING ((select auth.uid()) = user_id);

COMMIT;
