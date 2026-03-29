"""Add baseline-safe coach/sync tables for existing deployments.

Revision ID: 20250326_02
Revises: 20250326_01
Create Date: 2025-03-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250326_02"
down_revision: Union[str, None] = "20250326_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(insp: sa.Inspector, name: str) -> bool:
    return name in insp.get_table_names()


def _has_column(insp: sa.Inspector, table: str, column: str) -> bool:
    if not _has_table(insp, table):
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)

    if not _has_table(insp, "users"):
        return

    if not _has_table(insp, "notes"):
        op.create_table(
            "notes",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.user_id"), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("category", sa.String(), nullable=True),
            sa.Column("pinned", sa.Boolean(), nullable=True),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
        )
        op.create_index("ix_notes_user_id", "notes", ["user_id"])

    if not _has_table(insp, "inbox_items"):
        op.create_table(
            "inbox_items",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.user_id"), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("triaged", sa.Boolean(), nullable=True),
            sa.Column("triage_result", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(), nullable=True),
        )
        op.create_index("ix_inbox_items_user_id", "inbox_items", ["user_id"])

    if not _has_table(insp, "calendar_events"):
        op.create_table(
            "calendar_events",
            sa.Column("event_id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.user_id"), nullable=False),
            sa.Column("summary", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("location", sa.Text(), nullable=True),
            sa.Column("start_time", sa.String(), nullable=False),
            sa.Column("end_time", sa.String(), nullable=False),
            sa.Column("all_day", sa.Boolean(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("html_link", sa.Text(), nullable=True),
            sa.Column("google_calendar_id", sa.String(), nullable=True),
            sa.Column("synced_at", sa.String(), nullable=True),
            sa.Column("raw_json", sa.Text(), nullable=True),
        )
        op.create_index("ix_calendar_events_user_id", "calendar_events", ["user_id"])

    if not _has_table(insp, "email_cache"):
        op.create_table(
            "email_cache",
            sa.Column("message_id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.user_id"), nullable=False),
            sa.Column("thread_id", sa.String(), nullable=False),
            sa.Column("from_address", sa.String(), nullable=False),
            sa.Column("subject", sa.String(), nullable=False),
            sa.Column("snippet", sa.Text(), nullable=True),
            sa.Column("date", sa.String(), nullable=False),
            sa.Column("is_unread", sa.Boolean(), nullable=True),
            sa.Column("is_starred", sa.Boolean(), nullable=True),
            sa.Column("label_ids", sa.Text(), nullable=True),
            sa.Column("body_text", sa.Text(), nullable=True),
            sa.Column("synced_at", sa.String(), nullable=True),
        )
        op.create_index("ix_email_cache_user_id", "email_cache", ["user_id"])

    if not _has_table(insp, "email_categories"):
        op.create_table(
            "email_categories",
            sa.Column("message_id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.user_id"), nullable=False),
            sa.Column("category", sa.String(), nullable=False),
            sa.Column("extracted_tasks", sa.Text(), nullable=True),
            sa.Column("categorized_at", sa.String(), nullable=False),
        )
        op.create_index("ix_email_categories_user_id", "email_categories", ["user_id"])

    if not _has_table(insp, "sleep_sessions"):
        op.create_table(
            "sleep_sessions",
            sa.Column("session_id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.user_id"), nullable=False),
            sa.Column("sleep_start", sa.String(), nullable=False),
            sa.Column("sleep_end", sa.String(), nullable=True),
            sa.Column("duration_minutes", sa.Integer(), nullable=True),
        )
        op.create_index("ix_sleep_sessions_user_id", "sleep_sessions", ["user_id"])

    if not _has_table(insp, "coach_notifications"):
        op.create_table(
            "coach_notifications",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.user_id"), nullable=False),
            sa.Column("domain", sa.String(), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("priority", sa.String(), nullable=False),
            sa.Column("read", sa.Boolean(), nullable=True),
            sa.Column("acted_on", sa.Integer(), nullable=True),
            sa.Column("rule_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_coach_notifications_user_id", "coach_notifications", ["user_id"])

    if not _has_column(insp, "coach_notifications", "acted_on"):
        op.add_column(
            "coach_notifications",
            sa.Column("acted_on", sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    # Intentionally conservative: do not drop tables in downgrade for baseline-safe migration.
    pass
