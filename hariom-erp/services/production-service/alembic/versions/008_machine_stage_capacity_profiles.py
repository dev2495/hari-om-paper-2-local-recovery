"""machine_stage_capacity_profiles

Revision ID: 008_machine_stage_capacity
Revises: 007_dispatch_idem
Create Date: 2026-03-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "008_machine_stage_capacity"
down_revision = "007_dispatch_idem"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "machine_stage_capacity_profile",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("machine_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stage_type", sa.String(length=20), nullable=False),
        sa.Column("capacity_unit", sa.String(length=30), nullable=False),
        sa.Column("capacity_value", sa.Float(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("stage_type IN ('WINDER','OVEN','PROCESS')", name="ck_machine_stage_capacity_stage_type"),
        sa.CheckConstraint(
            "capacity_unit IN ('BAMBOOS_PER_DAY','METERS_PER_DAY','BATCHES_PER_DAY','TUBES_PER_DAY')",
            name="ck_machine_stage_capacity_unit",
        ),
        sa.CheckConstraint("capacity_value > 0", name="ck_machine_stage_capacity_positive"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "plant_id",
            "machine_id",
            "stage_type",
            "capacity_unit",
            "effective_date",
            name="uq_machine_stage_capacity_profile",
        ),
    )
    op.create_index(
        "ix_machine_stage_capacity_profile_plant_id",
        "machine_stage_capacity_profile",
        ["plant_id"],
        unique=False,
    )
    op.create_index(
        "ix_machine_stage_capacity_profile_machine_id",
        "machine_stage_capacity_profile",
        ["machine_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_machine_stage_capacity_profile_machine_id", table_name="machine_stage_capacity_profile")
    op.drop_index("ix_machine_stage_capacity_profile_plant_id", table_name="machine_stage_capacity_profile")
    op.drop_table("machine_stage_capacity_profile")
