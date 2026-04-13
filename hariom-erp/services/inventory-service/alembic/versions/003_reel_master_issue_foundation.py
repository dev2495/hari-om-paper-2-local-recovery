"""reel_master_issue_foundation

Revision ID: 003_reel_master_issue_foundation
Revises: 002_plant_isolation
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa


revision = "003_reel_master_issue_foundation"
down_revision = "002_plant_isolation"
branch_labels = None
depends_on = None


PLANT_A_UUID = "00000000-0000-0000-0000-0000000000a1"
PLANT_B_UUID = "00000000-0000-0000-0000-0000000000b2"

SEED_PAPER_A_ID = "00000000-0000-0000-0000-00000000e5a1"
SEED_PAPER_B_ID = "00000000-0000-0000-0000-00000000e5b2"

SEED_REEL_A1_ID = "00000000-0000-0000-0000-00000000e611"
SEED_REEL_A2_ID = "00000000-0000-0000-0000-00000000e612"
SEED_REEL_B1_ID = "00000000-0000-0000-0000-00000000e621"
SEED_REEL_B2_ID = "00000000-0000-0000-0000-00000000e622"

SEED_ISSUE_A_ID = "00000000-0000-0000-0000-00000000e701"
SEED_ISSUE_B_ID = "00000000-0000-0000-0000-00000000e702"

SEED_WINDER_A_MACHINE_ID = "00000000-0000-0000-0000-00000000a101"
SEED_WINDER_B_MACHINE_ID = "00000000-0000-0000-0000-00000000b201"


def upgrade() -> None:
    bind = op.get_bind()

    op.execute(
        """
        DO $$
        BEGIN
            CREATE TYPE reelstatus AS ENUM ('IN_STOCK', 'ISSUED', 'CONSUMED', 'SCRAP');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END$$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            CREATE TYPE reelissuestatus AS ENUM ('OPEN', 'CLOSED');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END$$;
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS paper_reels (
            id UUID PRIMARY KEY,
            plant_id UUID NOT NULL,
            reel_code VARCHAR(100) NOT NULL,
            paper_id UUID NOT NULL REFERENCES item_master(id),
            gsm DOUBLE PRECISION NULL,
            bf DOUBLE PRECISION NULL,
            supplier_name VARCHAR(200) NULL,
            inward_weight_kg DOUBLE PRECISION NOT NULL,
            current_weight_kg DOUBLE PRECISION NOT NULL,
            status reelstatus NOT NULL DEFAULT 'IN_STOCK',
            inward_date DATE NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT uq_paper_reels_plant_code UNIQUE (plant_id, reel_code),
            CONSTRAINT ck_paper_reels_inward_nonnegative CHECK (inward_weight_kg >= 0),
            CONSTRAINT ck_paper_reels_current_nonnegative CHECK (current_weight_kg >= 0),
            CONSTRAINT ck_paper_reels_current_lte_inward CHECK (current_weight_kg <= inward_weight_kg)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reel_issues (
            id UUID PRIMARY KEY,
            plant_id UUID NOT NULL,
            reel_id UUID NOT NULL REFERENCES paper_reels(id),
            winder_machine_id UUID NOT NULL,
            shift VARCHAR(20) NOT NULL,
            issue_date DATE NOT NULL,
            issued_weight_kg DOUBLE PRECISION NOT NULL,
            remaining_weight_kg DOUBLE PRECISION NOT NULL,
            status reelissuestatus NOT NULL DEFAULT 'OPEN',
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT ck_reel_issues_issued_positive CHECK (issued_weight_kg > 0),
            CONSTRAINT ck_reel_issues_remaining_nonnegative CHECK (remaining_weight_kg >= 0),
            CONSTRAINT ck_reel_issues_remaining_lte_issued CHECK (remaining_weight_kg <= issued_weight_kg)
        )
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS ix_paper_reels_plant_id ON paper_reels(plant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_paper_reels_status ON paper_reels(status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_reel_issues_plant_id ON reel_issues(plant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_reel_issues_status ON reel_issues(status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_reel_issues_reel_id ON reel_issues(reel_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reel_issues_winder_shift_date "
        "ON reel_issues(plant_id, winder_machine_id, shift, issue_date)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_reel_issues_open_per_reel
        ON reel_issues(reel_id)
        WHERE status = 'OPEN'
        """
    )

    bind.execute(
        sa.text(
            """
            INSERT INTO item_master (id, item_code, name, type, uom, active, plant_id, created_at)
            VALUES (
                CAST(:id AS uuid),
                :item_code,
                :name,
                CAST(:item_type AS itemtype),
                CAST(:uom AS uom),
                CAST(:active AS boolean_enum),
                CAST(:plant_id AS uuid),
                now()
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": SEED_PAPER_A_ID,
            "item_code": "PAPER-SEED-A-STEP5",
            "name": "Seed RAW PAPER Plant A",
            "item_type": "RAW_PAPER",
            "uom": "KG",
            "active": "true",
            "plant_id": PLANT_A_UUID,
        },
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO item_master (id, item_code, name, type, uom, active, plant_id, created_at)
            VALUES (
                CAST(:id AS uuid),
                :item_code,
                :name,
                CAST(:item_type AS itemtype),
                CAST(:uom AS uom),
                CAST(:active AS boolean_enum),
                CAST(:plant_id AS uuid),
                now()
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": SEED_PAPER_B_ID,
            "item_code": "PAPER-SEED-B-STEP5",
            "name": "Seed RAW PAPER Plant B",
            "item_type": "RAW_PAPER",
            "uom": "KG",
            "active": "true",
            "plant_id": PLANT_B_UUID,
        },
    )

    seed_reels = [
        {
            "id": SEED_REEL_A1_ID,
            "plant_id": PLANT_A_UUID,
            "reel_code": "REEL-A-001",
            "paper_id": SEED_PAPER_A_ID,
            "gsm": 230.0,
            "bf": 18.0,
            "supplier_name": "Seed Supplier A",
            "inward_weight_kg": 500.0,
            "current_weight_kg": 500.0,
            "status": "ISSUED",
            "inward_date": "2026-02-27",
        },
        {
            "id": SEED_REEL_A2_ID,
            "plant_id": PLANT_A_UUID,
            "reel_code": "REEL-A-002",
            "paper_id": SEED_PAPER_A_ID,
            "gsm": 301.0,
            "bf": 20.0,
            "supplier_name": "Seed Supplier A",
            "inward_weight_kg": 480.0,
            "current_weight_kg": 480.0,
            "status": "IN_STOCK",
            "inward_date": "2026-02-27",
        },
        {
            "id": SEED_REEL_B1_ID,
            "plant_id": PLANT_B_UUID,
            "reel_code": "REEL-B-001",
            "paper_id": SEED_PAPER_B_ID,
            "gsm": 230.0,
            "bf": 18.0,
            "supplier_name": "Seed Supplier B",
            "inward_weight_kg": 510.0,
            "current_weight_kg": 510.0,
            "status": "ISSUED",
            "inward_date": "2026-02-27",
        },
        {
            "id": SEED_REEL_B2_ID,
            "plant_id": PLANT_B_UUID,
            "reel_code": "REEL-B-002",
            "paper_id": SEED_PAPER_B_ID,
            "gsm": 351.0,
            "bf": 22.0,
            "supplier_name": "Seed Supplier B",
            "inward_weight_kg": 470.0,
            "current_weight_kg": 470.0,
            "status": "IN_STOCK",
            "inward_date": "2026-02-27",
        },
    ]

    for reel in seed_reels:
        bind.execute(
            sa.text(
                """
                INSERT INTO paper_reels (
                    id, plant_id, reel_code, paper_id, gsm, bf, supplier_name,
                    inward_weight_kg, current_weight_kg, status, inward_date, created_at
                )
                VALUES (
                    CAST(:id AS uuid),
                    CAST(:plant_id AS uuid),
                    :reel_code,
                    CAST(:paper_id AS uuid),
                    :gsm,
                    :bf,
                    :supplier_name,
                    :inward_weight_kg,
                    :current_weight_kg,
                    CAST(:status AS reelstatus),
                    :inward_date,
                    now()
                )
                ON CONFLICT (id) DO NOTHING
                """
            ),
            reel,
        )

    seed_issues = [
        {
            "id": SEED_ISSUE_A_ID,
            "plant_id": PLANT_A_UUID,
            "reel_id": SEED_REEL_A1_ID,
            "winder_machine_id": SEED_WINDER_A_MACHINE_ID,
            "shift": "A",
            "issue_date": "2026-02-27",
            "issued_weight_kg": 250.0,
            "remaining_weight_kg": 250.0,
            "status": "OPEN",
        },
        {
            "id": SEED_ISSUE_B_ID,
            "plant_id": PLANT_B_UUID,
            "reel_id": SEED_REEL_B1_ID,
            "winder_machine_id": SEED_WINDER_B_MACHINE_ID,
            "shift": "A",
            "issue_date": "2026-02-27",
            "issued_weight_kg": 240.0,
            "remaining_weight_kg": 240.0,
            "status": "OPEN",
        },
    ]

    for issue in seed_issues:
        bind.execute(
            sa.text(
                """
                INSERT INTO reel_issues (
                    id, plant_id, reel_id, winder_machine_id, shift, issue_date,
                    issued_weight_kg, remaining_weight_kg, status, created_at
                )
                VALUES (
                    CAST(:id AS uuid),
                    CAST(:plant_id AS uuid),
                    CAST(:reel_id AS uuid),
                    CAST(:winder_machine_id AS uuid),
                    :shift,
                    :issue_date,
                    :issued_weight_kg,
                    :remaining_weight_kg,
                    CAST(:status AS reelissuestatus),
                    now()
                )
                ON CONFLICT (id) DO NOTHING
                """
            ),
            issue,
        )


def downgrade() -> None:
    bind = op.get_bind()

    bind.execute(
        sa.text(
            """
            DELETE FROM reel_issues
            WHERE id IN (
                CAST(:issue_a AS uuid),
                CAST(:issue_b AS uuid)
            )
            """
        ),
        {"issue_a": SEED_ISSUE_A_ID, "issue_b": SEED_ISSUE_B_ID},
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM paper_reels
            WHERE id IN (
                CAST(:reel_a1 AS uuid),
                CAST(:reel_a2 AS uuid),
                CAST(:reel_b1 AS uuid),
                CAST(:reel_b2 AS uuid)
            )
            """
        ),
        {
            "reel_a1": SEED_REEL_A1_ID,
            "reel_a2": SEED_REEL_A2_ID,
            "reel_b1": SEED_REEL_B1_ID,
            "reel_b2": SEED_REEL_B2_ID,
        },
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM item_master
            WHERE id IN (
                CAST(:paper_a AS uuid),
                CAST(:paper_b AS uuid)
            )
            """
        ),
        {"paper_a": SEED_PAPER_A_ID, "paper_b": SEED_PAPER_B_ID},
    )

    op.execute("DROP INDEX IF EXISTS uq_reel_issues_open_per_reel")
    op.execute("DROP INDEX IF EXISTS ix_reel_issues_winder_shift_date")
    op.execute("DROP INDEX IF EXISTS ix_reel_issues_reel_id")
    op.execute("DROP INDEX IF EXISTS ix_reel_issues_status")
    op.execute("DROP INDEX IF EXISTS ix_reel_issues_plant_id")
    op.execute("DROP INDEX IF EXISTS ix_paper_reels_status")
    op.execute("DROP INDEX IF EXISTS ix_paper_reels_plant_id")

    op.execute("DROP TABLE IF EXISTS reel_issues")
    op.execute("DROP TABLE IF EXISTS paper_reels")

    op.execute("DROP TYPE IF EXISTS reelissuestatus")
    op.execute("DROP TYPE IF EXISTS reelstatus")
