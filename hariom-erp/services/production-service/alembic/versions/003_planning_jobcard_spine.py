"""planning_jobcard_spine

Revision ID: 003_planning_jobcard_spine
Revises: 002_plant_isolation
Create Date: 2026-02-27
"""

from datetime import datetime
import json

from alembic import op
import sqlalchemy as sa


revision = "003_planning_jobcard_spine"
down_revision = "002_plant_isolation"
branch_labels = None
depends_on = None

PLANT_A_UUID = "00000000-0000-0000-0000-0000000000a1"
SEED_CUSTOMER_ID = "00000000-0000-0000-0000-00000000c0a1"
SEED_SPEC_ID = "00000000-0000-0000-0000-0000000050a1"

SEED_SALES_ORDER_ID = "00000000-0000-0000-0000-00000000d401"
SEED_JOB_CARD_ID = "00000000-0000-0000-0000-00000000d402"
SEED_STAGE_WINDER_ID = "00000000-0000-0000-0000-00000000d411"
SEED_STAGE_OVEN_ID = "00000000-0000-0000-0000-00000000d412"
SEED_STAGE_PROCESS_ID = "00000000-0000-0000-0000-00000000d413"
SEED_STAGE_PACKING_ID = "00000000-0000-0000-0000-00000000d414"
SEED_QUEUE_WINDER_ID = "00000000-0000-0000-0000-00000000d421"


def _table_exists(bind, table_name: str) -> bool:
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "sales_orders"):
        op.execute(
            """
            CREATE TABLE sales_orders (
                id UUID PRIMARY KEY,
                plant_id UUID NOT NULL,
                customer_id UUID NOT NULL,
                spec_id UUID NOT NULL,
                order_qty FLOAT NOT NULL,
                due_date DATE NOT NULL,
                priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
                status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
                created_at TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT ck_sales_orders_priority CHECK (priority IN ('LOW','NORMAL','HIGH')),
                CONSTRAINT ck_sales_orders_status CHECK (status IN ('OPEN','PLANNED','COMPLETED','CANCELLED')),
                CONSTRAINT ck_sales_orders_qty_positive CHECK (order_qty > 0)
            )
            """
        )

    if not _table_exists(bind, "job_cards"):
        op.execute(
            """
            CREATE TABLE job_cards (
                id UUID PRIMARY KEY,
                plant_id UUID NOT NULL,
                sales_order_id UUID NOT NULL REFERENCES sales_orders(id),
                spec_id UUID NOT NULL,
                spec_snapshot JSONB NOT NULL,
                planned_qty FLOAT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
                current_stage VARCHAR(20) NOT NULL DEFAULT 'WINDER',
                created_at TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT ck_job_cards_status CHECK (
                    status IN ('CREATED','PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')
                ),
                CONSTRAINT ck_job_cards_current_stage CHECK (
                    current_stage IN ('WINDER','OVEN','PROCESS','PACKING','DONE')
                ),
                CONSTRAINT ck_job_cards_qty_positive CHECK (planned_qty > 0)
            )
            """
        )

    if not _table_exists(bind, "job_card_stages"):
        op.execute(
            """
            CREATE TABLE job_card_stages (
                id UUID PRIMARY KEY,
                job_card_id UUID NOT NULL REFERENCES job_cards(id),
                stage_type VARCHAR(20) NOT NULL,
                machine_id UUID NULL,
                planned_start TIMESTAMP NULL,
                planned_end TIMESTAMP NULL,
                actual_start TIMESTAMP NULL,
                actual_end TIMESTAMP NULL,
                input_qty FLOAT NULL,
                output_qty FLOAT NULL,
                scrap_qty FLOAT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
                remarks TEXT NULL,
                entered_by VARCHAR(200) NULL,
                entered_at TIMESTAMP NULL,
                created_at TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT uq_job_card_stage_type UNIQUE (job_card_id, stage_type),
                CONSTRAINT ck_job_card_stages_type CHECK (stage_type IN ('WINDER','OVEN','PROCESS','PACKING')),
                CONSTRAINT ck_job_card_stages_status CHECK (status IN ('QUEUED','ASSIGNED','RUNNING','COMPLETED')),
                CONSTRAINT ck_job_card_stages_input_nonnegative CHECK (COALESCE(input_qty, 0) >= 0),
                CONSTRAINT ck_job_card_stages_output_nonnegative CHECK (COALESCE(output_qty, 0) >= 0),
                CONSTRAINT ck_job_card_stages_scrap_nonnegative CHECK (COALESCE(scrap_qty, 0) >= 0)
            )
            """
        )

    if not _table_exists(bind, "stage_queue_order"):
        op.execute(
            """
            CREATE TABLE stage_queue_order (
                id UUID PRIMARY KEY,
                plant_id UUID NOT NULL,
                stage_type VARCHAR(20) NOT NULL,
                machine_id UUID NULL,
                job_card_id UUID NOT NULL REFERENCES job_cards(id),
                sequence_no INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT uq_stage_queue_job_stage UNIQUE (job_card_id, stage_type),
                CONSTRAINT ck_stage_queue_type CHECK (stage_type IN ('WINDER','OVEN','PROCESS','PACKING')),
                CONSTRAINT ck_stage_queue_sequence_positive CHECK (sequence_no > 0)
            )
            """
        )

    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_orders_plant_id ON sales_orders(plant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_orders_status ON sales_orders(status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_job_cards_plant_id ON job_cards(plant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_job_cards_sales_order_id ON job_cards(sales_order_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_job_cards_current_stage ON job_cards(current_stage)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_job_card_stages_job_card_id ON job_card_stages(job_card_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_job_card_stages_stage_type ON job_card_stages(stage_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stage_queue_order_plant_stage ON stage_queue_order(plant_id, stage_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stage_queue_order_machine ON stage_queue_order(machine_id)")

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_queue_machine_slot
        ON stage_queue_order (plant_id, stage_type, machine_id, sequence_no)
        WHERE machine_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_queue_unassigned_slot
        ON stage_queue_order (plant_id, stage_type, sequence_no)
        WHERE machine_id IS NULL
        """
    )

    created_at = datetime.utcnow()
    due_date = "2026-03-15"
    snapshot = {
        "spec_id": SEED_SPEC_ID,
        "customer_id": SEED_CUSTOMER_ID,
        "customer_name_snapshot": "Seed Customer Plant A",
        "tube_size_id": "00000000-0000-0000-0000-0000000070a1",
        "mandrel_id": "00000000-0000-0000-0000-0000000090a1",
        "target_tube_weight": 320.0,
        "required_cs": 500.0,
        "id_min_mm": 50,
        "id_max_mm": 55,
        "od_min_mm": 100,
        "od_max_mm": 110,
        "length_min_mm": 145,
        "length_max_mm": 155,
        "status": "approved",
        "version": 1,
        "priority": "NORMAL",
        "notch_capability_required": False,
    }

    bind.execute(
        sa.text(
            """
            INSERT INTO sales_orders (
                id, plant_id, customer_id, spec_id, order_qty, due_date, priority, status, created_at
            )
            VALUES (
                CAST(:id AS uuid), CAST(:plant_id AS uuid), CAST(:customer_id AS uuid), CAST(:spec_id AS uuid),
                :order_qty, :due_date, :priority, :status, :created_at
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": SEED_SALES_ORDER_ID,
            "plant_id": PLANT_A_UUID,
            "customer_id": SEED_CUSTOMER_ID,
            "spec_id": SEED_SPEC_ID,
            "order_qty": 1200.0,
            "due_date": due_date,
            "priority": "NORMAL",
            "status": "PLANNED",
            "created_at": created_at,
        },
    )

    bind.execute(
        sa.text(
            """
            INSERT INTO job_cards (
                id, plant_id, sales_order_id, spec_id, spec_snapshot, planned_qty, status, current_stage, created_at
            )
            VALUES (
                CAST(:id AS uuid), CAST(:plant_id AS uuid), CAST(:sales_order_id AS uuid), CAST(:spec_id AS uuid),
                CAST(:spec_snapshot AS jsonb), :planned_qty, :status, :current_stage, :created_at
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": SEED_JOB_CARD_ID,
            "plant_id": PLANT_A_UUID,
            "sales_order_id": SEED_SALES_ORDER_ID,
            "spec_id": SEED_SPEC_ID,
            "spec_snapshot": json.dumps(snapshot),
            "planned_qty": 1200.0,
            "status": "CREATED",
            "current_stage": "WINDER",
            "created_at": created_at,
        },
    )

    stage_rows = [
        (SEED_STAGE_WINDER_ID, "WINDER"),
        (SEED_STAGE_OVEN_ID, "OVEN"),
        (SEED_STAGE_PROCESS_ID, "PROCESS"),
        (SEED_STAGE_PACKING_ID, "PACKING"),
    ]
    for stage_id, stage_type in stage_rows:
        bind.execute(
            sa.text(
                """
                INSERT INTO job_card_stages (
                    id, job_card_id, stage_type, status, created_at
                )
                VALUES (
                    CAST(:id AS uuid), CAST(:job_card_id AS uuid), :stage_type, 'QUEUED', :created_at
                )
                ON CONFLICT (id) DO NOTHING
                """
            ),
            {
                "id": stage_id,
                "job_card_id": SEED_JOB_CARD_ID,
                "stage_type": stage_type,
                "created_at": created_at,
            },
        )

    bind.execute(
        sa.text(
            """
            INSERT INTO stage_queue_order (
                id, plant_id, stage_type, machine_id, job_card_id, sequence_no, created_at
            )
            VALUES (
                CAST(:id AS uuid), CAST(:plant_id AS uuid), 'WINDER', NULL, CAST(:job_card_id AS uuid), 1, :created_at
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": SEED_QUEUE_WINDER_ID,
            "plant_id": PLANT_A_UUID,
            "job_card_id": SEED_JOB_CARD_ID,
            "created_at": created_at,
        },
    )


def downgrade() -> None:
    bind = op.get_bind()

    bind.execute(
        sa.text(
            """
            DELETE FROM stage_queue_order
            WHERE id = CAST(:queue_id AS uuid)
            """
        ),
        {"queue_id": SEED_QUEUE_WINDER_ID},
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM job_card_stages
            WHERE id IN (
                CAST(:winder AS uuid),
                CAST(:oven AS uuid),
                CAST(:process AS uuid),
                CAST(:packing AS uuid)
            )
            """
        ),
        {
            "winder": SEED_STAGE_WINDER_ID,
            "oven": SEED_STAGE_OVEN_ID,
            "process": SEED_STAGE_PROCESS_ID,
            "packing": SEED_STAGE_PACKING_ID,
        },
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM job_cards
            WHERE id = CAST(:job_card_id AS uuid)
            """
        ),
        {"job_card_id": SEED_JOB_CARD_ID},
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM sales_orders
            WHERE id = CAST(:sales_order_id AS uuid)
            """
        ),
        {"sales_order_id": SEED_SALES_ORDER_ID},
    )

    op.execute("DROP INDEX IF EXISTS uq_stage_queue_unassigned_slot")
    op.execute("DROP INDEX IF EXISTS uq_stage_queue_machine_slot")
    op.execute("DROP INDEX IF EXISTS ix_stage_queue_order_machine")
    op.execute("DROP INDEX IF EXISTS ix_stage_queue_order_plant_stage")
    op.execute("DROP INDEX IF EXISTS ix_job_card_stages_stage_type")
    op.execute("DROP INDEX IF EXISTS ix_job_card_stages_job_card_id")
    op.execute("DROP INDEX IF EXISTS ix_job_cards_current_stage")
    op.execute("DROP INDEX IF EXISTS ix_job_cards_sales_order_id")
    op.execute("DROP INDEX IF EXISTS ix_job_cards_plant_id")
    op.execute("DROP INDEX IF EXISTS ix_sales_orders_status")
    op.execute("DROP INDEX IF EXISTS ix_sales_orders_plant_id")

    if _table_exists(bind, "stage_queue_order"):
        op.drop_table("stage_queue_order")
    if _table_exists(bind, "job_card_stages"):
        op.drop_table("job_card_stages")
    if _table_exists(bind, "job_cards"):
        op.drop_table("job_cards")
    if _table_exists(bind, "sales_orders"):
        op.drop_table("sales_orders")
