"""plant_tolerance_setting

Per-plant override table for variance tolerances. Falls through to the
global VARIANCE_TOLERANCE_* constants when no row exists.

Revision ID: 010_plant_tolerance_setting
Revises: 009_winder_meter_capacity
Create Date: 2026-05-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID


revision = "010_plant_tolerance_setting"
down_revision = "009_winder_meter_capacity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plant_tolerance_setting",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("plant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("default_kg", sa.Float(), nullable=False, server_default="5.0"),
        sa.Column("raw_paper_kg", sa.Float(), nullable=True),
        sa.Column("adhesive_kg", sa.Float(), nullable=True),
        sa.Column("parchment_kg", sa.Float(), nullable=True),
        sa.Column("packaging_kg", sa.Float(), nullable=True),
        sa.Column("paper_expected_consumption_factor", sa.Float(), nullable=True),
        sa.Column("paper_standard_wastage_percent", sa.Float(), nullable=True),
        sa.Column("updated_by", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index(
        "ix_plant_tolerance_setting_plant_id",
        "plant_tolerance_setting",
        ["plant_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_plant_tolerance_setting_plant_id", table_name="plant_tolerance_setting")
    op.drop_table("plant_tolerance_setting")
