"""reel_reconciliation_foundation

Revision ID: 005_reel_recon
Revises: 004_relax_planning_gating
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "005_reel_recon"
down_revision = "004_relax_planning_gating"
branch_labels = None
depends_on = None


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(bind)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()

    if not _column_exists(bind, "job_card_stages", "reel_issue_ids"):
        op.add_column(
            "job_card_stages",
            sa.Column(
                "reel_issue_ids",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )

    bind.execute(sa.text("UPDATE job_card_stages SET reel_issue_ids = '[]'::jsonb WHERE reel_issue_ids IS NULL"))
    op.alter_column(
        "job_card_stages",
        "reel_issue_ids",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_job_card_stages_reel_issue_ids_gin "
        "ON job_card_stages USING GIN (reel_issue_ids)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_job_card_stages_reel_issue_ids_gin")
    bind = op.get_bind()
    if _column_exists(bind, "job_card_stages", "reel_issue_ids"):
        op.drop_column("job_card_stages", "reel_issue_ids")
