"""Baseline existing SQL migrations.

Revision ID: 0045_existing_sql_baseline
Revises:
Create Date: 2026-06-17 00:00:00.000000

Historical SQL migrations are stamped, not replayed. The raw SQL migration
directory remains the source of historical schema changes through
backend/migrations/0045_add_file_content_hash.sql.
"""

from __future__ import annotations


revision = "0045_existing_sql_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Historical SQL migrations are stamped, not replayed."""
    pass


def downgrade() -> None:
    """Do not downgrade the historical raw-SQL baseline."""
    pass
