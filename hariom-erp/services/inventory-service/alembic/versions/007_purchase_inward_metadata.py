"""purchase and inward metadata

Revision ID: 007_purchase_inward_metadata
Revises: 006_item_tracking_mode
Create Date: 2026-07-03
"""

from alembic import op


revision = "007_purchase_inward_metadata"
down_revision = "006_item_tracking_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS inward_metadata JSONB")
    op.execute("ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS inward_metadata JSONB")
    op.execute("ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS metadata_json JSONB")
    op.execute("ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS metadata_json JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE purchase_order_lines DROP COLUMN IF EXISTS metadata_json")
    op.execute("ALTER TABLE purchase_orders DROP COLUMN IF EXISTS metadata_json")
    op.execute("ALTER TABLE paper_reels DROP COLUMN IF EXISTS inward_metadata")
    op.execute("ALTER TABLE stock_batch DROP COLUMN IF EXISTS inward_metadata")
