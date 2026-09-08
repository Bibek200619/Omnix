-- Restrict direct PostgREST access to documents and files.  Application
-- retrieval runs through the service role, while authenticated users may only
-- read documents and files they own privately or can access through an active
-- workspace membership.

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Scoped Document Visibility" ON public.documents;
DROP POLICY IF EXISTS documents_own ON public.documents;
DROP POLICY IF EXISTS "Users can read their own private documents" ON public.documents;
DROP POLICY IF EXISTS "Workspace members can read workspace documents" ON public.documents;

CREATE POLICY "Users can read their own private documents"
    ON public.documents
    FOR SELECT
    TO authenticated
    USING (workspace_id IS NULL AND auth.uid() = user_id);

CREATE POLICY "Workspace members can read workspace documents"
    ON public.documents
    FOR SELECT
    TO authenticated
    USING (
        workspace_id IS NOT NULL
        AND public.omnix_has_workspace_task_access(workspace_id)
    );

DROP POLICY IF EXISTS "Scoped File Visibility" ON public.files;
DROP POLICY IF EXISTS files_own ON public.files;
DROP POLICY IF EXISTS "Users can read their own private files" ON public.files;
DROP POLICY IF EXISTS "Workspace members can read workspace files" ON public.files;

CREATE POLICY "Users can read their own private files"
    ON public.files
    FOR SELECT
    TO authenticated
    USING (workspace_id IS NULL AND auth.uid() = user_id);

CREATE POLICY "Workspace members can read workspace files"
    ON public.files
    FOR SELECT
    TO authenticated
    USING (
        workspace_id IS NOT NULL
        AND public.omnix_has_workspace_task_access(workspace_id)
    );

REVOKE ALL ON TABLE public.documents FROM PUBLIC;
REVOKE ALL ON TABLE public.documents FROM anon;
REVOKE ALL ON TABLE public.documents FROM authenticated;
GRANT SELECT ON TABLE public.documents TO authenticated;
GRANT ALL ON TABLE public.documents TO service_role;

REVOKE ALL ON TABLE public.files FROM PUBLIC;
REVOKE ALL ON TABLE public.files FROM anon;
REVOKE ALL ON TABLE public.files FROM authenticated;
GRANT SELECT ON TABLE public.files TO authenticated;
GRANT ALL ON TABLE public.files TO service_role;

-- The linked project contains two historical overloads that are not present
-- in the tracked baseline.  Make each grant adjustment conditional so both a
-- clean rebuild and the existing project converge on the same role boundary.
DO $$
DECLARE
    target_function regprocedure;
BEGIN
    FOR target_function IN
        SELECT to_regprocedure(signature)
        FROM unnest(ARRAY[
            'public.search_documents_keyword(text, integer, uuid, uuid)',
            'public.search_documents_keyword(text, integer, uuid, uuid[])',
            'public.search_documents_vector(double precision[], integer, uuid, uuid)',
            'public.search_documents_vector(double precision[], integer, uuid, uuid[])',
            'public.search_documents_vector(vector, integer, uuid, uuid[])',
            'public.match_documents(vector, double precision, integer, uuid)',
            'public.match_documents(vector, double precision, integer, uuid, uuid[])'
        ]) AS retrieval_functions(signature)
        WHERE to_regprocedure(signature) IS NOT NULL
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', target_function);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', target_function);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', target_function);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', target_function);
    END LOOP;
END;
$$;
