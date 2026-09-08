-- Accepting an invite must create membership and consume the invite in one
-- transaction. Only the trusted backend may supply the verified user/email pair.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_members
ON public.workspace_members (workspace_id, user_id);

CREATE OR REPLACE FUNCTION public.accept_workspace_invite_atomic(
    p_invite_id uuid,
    p_user_id uuid,
    p_email text
)
RETURNS TABLE (
    outcome text,
    accepted_workspace_id uuid,
    membership_created boolean,
    invite_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    invite_record public.workspace_invites%ROWTYPE;
    normalized_role text;
    membership_rows integer := 0;
BEGIN
    IF p_invite_id IS NULL
       OR p_user_id IS NULL
       OR nullif(btrim(p_email), '') IS NULL THEN
        RETURN QUERY
        SELECT 'not_found'::text, NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    SELECT invite.*
    INTO invite_record
    FROM public.workspace_invites AS invite
    WHERE invite.id = p_invite_id
      AND lower(btrim(invite.email)) = lower(btrim(p_email))
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 'not_found'::text, NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    IF invite_record.status <> 'pending' THEN
        RETURN QUERY
        SELECT
            'not_pending'::text,
            invite_record.workspace_id,
            false,
            invite_record.status;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.workspaces AS workspace
        WHERE workspace.id = invite_record.workspace_id
    ) THEN
        RETURN QUERY
        SELECT
            'workspace_not_found'::text,
            invite_record.workspace_id,
            false,
            invite_record.status;
        RETURN;
    END IF;

    normalized_role := CASE lower(replace(btrim(coalesce(invite_record.role, '')), '-', '_'))
        WHEN 'founder' THEN 'founder'
        WHEN 'owner' THEN 'co_owner'
        WHEN 'co_owner' THEN 'co_owner'
        WHEN 'sub_leader' THEN 'co_owner'
        WHEN 'team_lead' THEN 'team_lead'
        ELSE 'member'
    END;

    INSERT INTO public.workspace_members (
        workspace_id,
        user_id,
        role,
        created_at,
        updated_at
    )
    VALUES (
        invite_record.workspace_id,
        p_user_id,
        normalized_role,
        transaction_timestamp(),
        transaction_timestamp()
    )
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

    GET DIAGNOSTICS membership_rows = ROW_COUNT;

    UPDATE public.workspace_invites AS invite
    SET
        status = 'accepted',
        accepted_by_user_id = p_user_id,
        accepted_at = transaction_timestamp(),
        updated_at = transaction_timestamp()
    WHERE invite.id = invite_record.id
      AND invite.status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'workspace invite transition lost'
            USING ERRCODE = '40001';
    END IF;

    RETURN QUERY
    SELECT
        'accepted'::text,
        invite_record.workspace_id,
        membership_rows = 1,
        'accepted'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_workspace_invite_atomic(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_workspace_invite_atomic(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.accept_workspace_invite_atomic(uuid, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.accept_workspace_invite_atomic(uuid, uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite_atomic(uuid, uuid, text) TO service_role;

COMMIT;
