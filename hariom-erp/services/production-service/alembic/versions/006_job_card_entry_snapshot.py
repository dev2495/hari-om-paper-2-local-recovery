"""job_card_entry_snapshot

Revision ID: 006_job_card_entry_snapshot
Revises: 005_reel_recon
Create Date: 2026-03-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "006_job_card_entry_snapshot"
down_revision = "005_reel_recon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_card_stages",
        sa.Column(
            "entry_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("job_card_stages", "entry_snapshot")
