"""relax_planning_gating

Revision ID: 004_relax_planning_gating
Revises: 003_planning_jobcard_spine
Create Date: 2026-02-27
"""

import uuid

from alembic import op
import sqlalchemy as sa


revision = "004_relax_planning_gating"
down_revision = "003_planning_jobcard_spine"
branch_labels = None
depends_on = None


def _check_exists(bind, table_name: str, check_name: str) -> bool:
    inspector = sa.inspect(bind)
    return any(constraint["name"] == check_name for constraint in inspector.get_check_constraints(table_name))


def upgrade() -> None:
    bind = op.get_bind()

    op.execute("ALTER TABLE job_card_stages ALTER COLUMN status SET DEFAULT 'PLANNED'")

    if _check_exists(bind, "job_card_stages", "ck_job_card_stages_status"):
        op.drop_constraint("ck_job_card_stages_status", "job_card_stages", type_="check")
    op.create_check_constraint(
        "ck_job_card_stages_status",
        "job_card_stages",
        "status IN ('PLANNED','QUEUED','ASSIGNED','RUNNING','COMPLETED')",
    )

    bind.execute(sa.text("UPDATE job_card_stages SET status = 'PLANNED' WHERE status = 'QUEUED'"))

    missing_rows = bind.execute(
        sa.text(
            """
            SELECT jc.id AS job_card_id, jc.plant_id AS plant_id, jcs.stage_type AS stage_type
            FROM job_cards jc
            JOIN job_card_stages jcs ON jcs.job_card_id = jc.id
            LEFT JOIN stage_queue_order sq
                ON sq.job_card_id = jc.id
               AND sq.stage_type = jcs.stage_type
            WHERE sq.id IS NULL
              AND jcs.status != 'COMPLETED'
            ORDER BY jc.created_at, jcs.stage_type
            """
        )
    ).fetchall()

    for row in missing_rows:
        next_sequence = bind.execute(
            sa.text(
                """
                SELECT COALESCE(MAX(sequence_no), 0) + 1
                FROM stage_queue_order
                WHERE plant_id = :plant_id
                  AND stage_type = :stage_type
                  AND machine_id IS NULL
                """
            ),
            {"plant_id": row.plant_id, "stage_type": row.stage_type},
        ).scalar()
        bind.execute(
            sa.text(
                """
                INSERT INTO stage_queue_order (
                    id, plant_id, stage_type, machine_id, job_card_id, sequence_no, created_at
                )
                VALUES (
                    CAST(:id AS uuid), CAST(:plant_id AS uuid), :stage_type, NULL, CAST(:job_card_id AS uuid), :sequence_no, now()
                )
                ON CONFLICT (job_card_id, stage_type) DO NOTHING
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "plant_id": row.plant_id,
                "stage_type": row.stage_type,
                "job_card_id": row.job_card_id,
                "sequence_no": int(next_sequence or 1),
            },
        )


def downgrade() -> None:
    bind = op.get_bind()

    op.execute("ALTER TABLE job_card_stages ALTER COLUMN status SET DEFAULT 'QUEUED'")

    if _check_exists(bind, "job_card_stages", "ck_job_card_stages_status"):
        op.drop_constraint("ck_job_card_stages_status", "job_card_stages", type_="check")
    op.create_check_constraint(
        "ck_job_card_stages_status",
        "job_card_stages",
        "status IN ('QUEUED','ASSIGNED','RUNNING','COMPLETED')",
    )

    bind.execute(sa.text("UPDATE job_card_stages SET status = 'QUEUED' WHERE status = 'PLANNED'"))
