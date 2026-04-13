"""plant_isolation

Revision ID: 002_plant_isolation
Revises: 001
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "002_plant_isolation"
down_revision = "001"
branch_labels = None
depends_on = None


PLANT_A_UUID = "00000000-0000-0000-0000-0000000000a1"
PLANT_B_UUID = "00000000-0000-0000-0000-0000000000b2"


def _column_type(connection, table_name: str, column_name: str):
    return connection.execute(
        sa.text(
            """
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = :table_name AND column_name = :column_name
            """
        ),
        {"table_name": table_name, "column_name": column_name},
    ).scalar()


def upgrade() -> None:
    connection = op.get_bind()

    plant_type = _column_type(connection, "production_job", "plant_id")
    if not plant_type:
        op.add_column("production_job", sa.Column("plant_id", postgresql.UUID(as_uuid=True), nullable=True))
    elif plant_type != "uuid":
        op.add_column("production_job", sa.Column("plant_id_v2", postgresql.UUID(as_uuid=True), nullable=True))
        connection.execute(
            sa.text(
                """
                UPDATE production_job
                SET plant_id_v2 = CASE
                    WHEN upper(COALESCE(plant_id::text, '')) IN ('PLANT_B', 'PLANT-2', 'PLANT2') THEN CAST(:plant_b AS uuid)
                    WHEN plant_id::text ~* '^[0-9a-f-]{36}$' THEN plant_id::text::uuid
                    ELSE CAST(:plant_a AS uuid)
                END
                """
            ),
            {"plant_a": PLANT_A_UUID, "plant_b": PLANT_B_UUID},
        )
        op.drop_column("production_job", "plant_id")
        op.alter_column("production_job", "plant_id_v2", new_column_name="plant_id", existing_type=postgresql.UUID(as_uuid=True))

    connection.execute(
        sa.text(
            """
            UPDATE production_job
            SET plant_id = COALESCE(plant_id, CAST(:plant_a AS uuid))
            """
        ),
        {"plant_a": PLANT_A_UUID},
    )

    op.alter_column("production_job", "plant_id", nullable=False, existing_type=postgresql.UUID(as_uuid=True))

    reel_plant_type = _column_type(connection, "reel_issues", "plant_id")
    if not reel_plant_type:
        op.add_column("reel_issues", sa.Column("plant_id", postgresql.UUID(as_uuid=True), nullable=True))
    elif reel_plant_type != "uuid":
        op.add_column("reel_issues", sa.Column("plant_id_v2", postgresql.UUID(as_uuid=True), nullable=True))
        connection.execute(
            sa.text(
                """
                UPDATE reel_issues
                SET plant_id_v2 = CASE
                    WHEN upper(COALESCE(plant_id::text, '')) IN ('PLANT_B', 'PLANT-2', 'PLANT2') THEN CAST(:plant_b AS uuid)
                    WHEN plant_id::text ~* '^[0-9a-f-]{36}$' THEN plant_id::text::uuid
                    ELSE CAST(:plant_a AS uuid)
                END
                """
            ),
            {"plant_a": PLANT_A_UUID, "plant_b": PLANT_B_UUID},
        )
        op.drop_column("reel_issues", "plant_id")
        op.alter_column("reel_issues", "plant_id_v2", new_column_name="plant_id", existing_type=postgresql.UUID(as_uuid=True))

    connection.execute(
        sa.text(
            """
            UPDATE reel_issues r
            SET plant_id = COALESCE(r.plant_id, j.plant_id, CAST(:plant_a AS uuid))
            FROM production_job j
            WHERE j.id = r.job_id
            """
        ),
        {"plant_a": PLANT_A_UUID},
    )
    connection.execute(
        sa.text(
            """
            UPDATE reel_issues
            SET plant_id = COALESCE(plant_id, CAST(:plant_a AS uuid))
            """
        ),
        {"plant_a": PLANT_A_UUID},
    )

    op.alter_column("reel_issues", "plant_id", nullable=False, existing_type=postgresql.UUID(as_uuid=True))

    connection.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_production_job_plant_id ON production_job(plant_id)"))
    connection.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_reel_issues_plant_id ON reel_issues(plant_id)"))


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(sa.text("DROP INDEX IF EXISTS ix_reel_issues_plant_id"))
    connection.execute(sa.text("DROP INDEX IF EXISTS ix_production_job_plant_id"))

    op.drop_column("reel_issues", "plant_id")

    op.add_column("production_job", sa.Column("plant_id_legacy", sa.String(length=50), nullable=True))
    connection.execute(
        sa.text(
            """
            UPDATE production_job
            SET plant_id_legacy = CASE
                WHEN plant_id::text = :plant_b THEN 'PLANT_B'
                ELSE 'PLANT_A'
            END
            """
        ),
        {"plant_b": PLANT_B_UUID},
    )
    op.drop_column("production_job", "plant_id")
    op.alter_column("production_job", "plant_id_legacy", new_column_name="plant_id", existing_type=sa.String(length=50))
