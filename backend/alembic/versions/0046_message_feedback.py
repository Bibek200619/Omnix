"""Add AI message feedback table.

Revision ID: 0046_message_feedback
Revises: 0045_existing_sql_baseline
Create Date: 2026-06-17 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0046_message_feedback"
down_revision = "0045_existing_sql_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    op.execute(
        """
CREATE TABLE IF NOT EXISTS public.message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rating text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_feedback_rating_check CHECK (rating IN ('good', 'bad')),
  CONSTRAINT message_feedback_reason_check CHECK (reason IS NULL OR char_length(reason) <= 1000),
  UNIQUE (message_id, user_id)
);
"""
    )
    op.execute(
        """
DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_feedback_user_id_auth_users_fkey') THEN
      ALTER TABLE public.message_feedback
        ADD CONSTRAINT message_feedback_user_id_auth_users_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    RAISE NOTICE 'Skipping message_feedback.user_id auth foreign key because auth.users is unavailable.';
  END;
END;
$$;
"""
    )
    op.execute(
        """
CREATE INDEX IF NOT EXISTS idx_message_feedback_workspace_created
  ON public.message_feedback(workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_feedback_conversation
  ON public.message_feedback(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_feedback_user_created
  ON public.message_feedback(user_id, created_at DESC);
"""
    )
    op.execute(
        """
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read message feedback" ON public.message_feedback;
CREATE POLICY "Users can read message feedback"
  ON public.message_feedback FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      workspace_id IS NOT NULL
      AND public.omnix_has_workspace_task_access(workspace_id)
    )
  );

DROP POLICY IF EXISTS "Users can create message feedback" ON public.message_feedback;
CREATE POLICY "Users can create message feedback"
  ON public.message_feedback FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR public.omnix_has_workspace_task_access(workspace_id)
    )
  );

DROP POLICY IF EXISTS "Users can update their message feedback" ON public.message_feedback;
CREATE POLICY "Users can update their message feedback"
  ON public.message_feedback FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR public.omnix_has_workspace_task_access(workspace_id)
    )
  );
"""
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return

    op.execute("DROP TABLE IF EXISTS public.message_feedback;")
