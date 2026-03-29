"""Add users.coach_timezone for per-user coach windows.

Revision ID: 20250326_01
Revises:
Create Date: 2025-03-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250326_01"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "coach_timezone" not in cols:
        op.add_column(
            "users",
            sa.Column("coach_timezone", sa.String(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "coach_timezone" in cols:
        op.drop_column("users", "coach_timezone")
