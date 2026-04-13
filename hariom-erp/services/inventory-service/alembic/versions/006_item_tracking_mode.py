"""add tracking mode for bulk vs reel items

Revision ID: 006_item_tracking_mode
Revises: 005_inventory_valuation
Create Date: 2026-03-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "006_item_tracking_mode"
down_revision = "005_inventory_valuation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tracking_mode_enum = postgresql.ENUM("REEL", "BULK", name="trackingmode")
    tracking_mode_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "item_master",
        sa.Column(
            "tracking_mode",
            sa.Enum("REEL", "BULK", name="trackingmode", create_type=False),
            nullable=True,
            server_default="BULK",
        ),
    )
    op.execute(
        """
        UPDATE item_master
        SET tracking_mode = CASE
            WHEN type = 'RAW_PAPER' THEN 'REEL'::trackingmode
            ELSE 'BULK'::trackingmode
        END
        """
    )
    op.alter_column("item_master", "tracking_mode", nullable=False, server_default="BULK")


def downgrade() -> None:
    op.drop_column("item_master", "tracking_mode")
    tracking_mode_enum = postgresql.ENUM("REEL", "BULK", name="trackingmode")
    tracking_mode_enum.drop(op.get_bind(), checkfirst=True)
