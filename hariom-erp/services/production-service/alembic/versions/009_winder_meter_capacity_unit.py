"""winder_meter_capacity_unit

Revision ID: 009_winder_meter_capacity
Revises: 008_machine_stage_capacity
Create Date: 2026-05-18
"""

from alembic import op


revision = "009_winder_meter_capacity"
down_revision = "008_machine_stage_capacity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE machine_stage_capacity_profile DROP CONSTRAINT IF EXISTS ck_machine_stage_capacity_unit")
    op.execute(
        """
        UPDATE machine_stage_capacity_profile
        SET capacity_value = capacity_value * 1.56,
            capacity_unit = 'METERS_PER_DAY'
        WHERE stage_type = 'WINDER'
          AND capacity_unit = 'BAMBOOS_PER_DAY'
        """
    )
    op.execute(
        """
        ALTER TABLE machine_stage_capacity_profile
        ADD CONSTRAINT ck_machine_stage_capacity_unit
        CHECK (capacity_unit IN ('BAMBOOS_PER_DAY','METERS_PER_DAY','BATCHES_PER_DAY','TUBES_PER_DAY'))
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE machine_stage_capacity_profile DROP CONSTRAINT IF EXISTS ck_machine_stage_capacity_unit")
    op.execute(
        """
        UPDATE machine_stage_capacity_profile
        SET capacity_value = capacity_value / 1.56,
            capacity_unit = 'BAMBOOS_PER_DAY'
        WHERE stage_type = 'WINDER'
          AND capacity_unit = 'METERS_PER_DAY'
        """
    )
    op.execute(
        """
        ALTER TABLE machine_stage_capacity_profile
        ADD CONSTRAINT ck_machine_stage_capacity_unit
        CHECK (capacity_unit IN ('BAMBOOS_PER_DAY','BATCHES_PER_DAY','TUBES_PER_DAY'))
        """
    )
