"""inventory_valuation

Revision ID: 005_inventory_valuation
Revises: 004_reel_scan_events
Create Date: 2026-02-27
"""

from alembic import op


revision = "005_inventory_valuation"
down_revision = "004_reel_scan_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            CREATE TYPE costsource AS ENUM ('MANUAL', 'SUPPLIER', 'AVG_BATCH');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END$$;
        """
    )

    op.execute("ALTER TABLE item_master ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION NULL")
    op.execute("ALTER TABLE item_master ADD COLUMN IF NOT EXISTS cost_source costsource NULL")
    op.execute(
        """
        DO $$
        BEGIN
            ALTER TABLE item_master
            ADD CONSTRAINT ck_item_master_unit_cost_nonnegative
            CHECK (unit_cost IS NULL OR unit_cost >= 0);
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END$$;
        """
    )

    op.execute("ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION NULL")
    op.execute("ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS cost_source costsource NULL")
    op.execute(
        """
        DO $$
        BEGIN
            ALTER TABLE paper_reels
            ADD CONSTRAINT ck_paper_reels_unit_cost_nonnegative
            CHECK (unit_cost IS NULL OR unit_cost >= 0);
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END$$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE paper_reels DROP CONSTRAINT IF EXISTS ck_paper_reels_unit_cost_nonnegative")
    op.execute("ALTER TABLE paper_reels DROP COLUMN IF EXISTS cost_source")
    op.execute("ALTER TABLE paper_reels DROP COLUMN IF EXISTS unit_cost")

    op.execute("ALTER TABLE item_master DROP CONSTRAINT IF EXISTS ck_item_master_unit_cost_nonnegative")
    op.execute("ALTER TABLE item_master DROP COLUMN IF EXISTS cost_source")
    op.execute("ALTER TABLE item_master DROP COLUMN IF EXISTS unit_cost")

    op.execute("DROP TYPE IF EXISTS costsource")
