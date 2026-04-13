"""dispatch_idempotency_and_sales_line

Revision ID: 007_dispatch_idem
Revises: 006_job_card_entry_snapshot
Create Date: 2026-03-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "007_dispatch_idem"
down_revision = "006_job_card_entry_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_cards", sa.Column("sales_order_line_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_job_cards_sales_order_line_id", "job_cards", ["sales_order_line_id"], unique=False)

    op.create_table(
        "dispatch_idempotency",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_id", sa.String(length=120), nullable=False),
        sa.Column("job_card_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_hash", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("response_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("status IN ('PENDING', 'SUCCESS', 'FAILED')", name="ck_dispatch_idempotency_status"),
        sa.ForeignKeyConstraint(["job_card_id"], ["job_cards.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("request_id"),
    )
    op.create_index("ix_dispatch_idempotency_plant_id", "dispatch_idempotency", ["plant_id"], unique=False)
    op.create_index("ix_dispatch_idempotency_job_card_id", "dispatch_idempotency", ["job_card_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_dispatch_idempotency_job_card_id", table_name="dispatch_idempotency")
    op.drop_index("ix_dispatch_idempotency_plant_id", table_name="dispatch_idempotency")
    op.drop_table("dispatch_idempotency")
    op.drop_index("ix_job_cards_sales_order_line_id", table_name="job_cards")
    op.drop_column("job_cards", "sales_order_line_id")
