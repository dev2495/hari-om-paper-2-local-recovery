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


def _table_exists(connection, table_name: str) -> bool:
    return (
        connection.execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = current_schema() AND table_name = :table_name
                )
                """
            ),
            {"table_name": table_name},
        ).scalar()
        is True
    )


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


def _upgrade_table(connection, table_name: str):
    if not _table_exists(connection, table_name):
        return

    plant_type = _column_type(connection, table_name, "plant_id")
    if not plant_type:
        op.add_column(table_name, sa.Column("plant_id", postgresql.UUID(as_uuid=True), nullable=True))
    elif plant_type != "uuid":
        op.add_column(table_name, sa.Column("plant_id_v2", postgresql.UUID(as_uuid=True), nullable=True))
        connection.execute(
            sa.text(
                f"""
                UPDATE {table_name}
                SET plant_id_v2 = CASE
                    WHEN upper(COALESCE(plant_id::text, '')) IN ('PLANT_B', 'PLANT-2', 'PLANT2') THEN CAST(:plant_b AS uuid)
                    WHEN plant_id::text ~* '^[0-9a-f-]{{36}}$' THEN plant_id::text::uuid
                    ELSE CAST(:plant_a AS uuid)
                END
                """
            ),
            {"plant_a": PLANT_A_UUID, "plant_b": PLANT_B_UUID},
        )
        op.drop_column(table_name, "plant_id")
        op.alter_column(table_name, "plant_id_v2", new_column_name="plant_id", existing_type=postgresql.UUID(as_uuid=True))

    connection.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET plant_id = COALESCE(plant_id, CAST(:plant_a AS uuid))
            """
        ),
        {"plant_a": PLANT_A_UUID},
    )
    op.alter_column(table_name, "plant_id", nullable=False, existing_type=postgresql.UUID(as_uuid=True))


def _downgrade_table(connection, table_name: str):
    if not _table_exists(connection, table_name):
        return

    op.add_column(table_name, sa.Column("plant_id_legacy", sa.String(length=50), nullable=True))
    connection.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET plant_id_legacy = CASE
                WHEN plant_id::text = :plant_b THEN 'PLANT_B'
                ELSE 'PLANT_A'
            END
            """
        ),
        {"plant_b": PLANT_B_UUID},
    )
    op.drop_column(table_name, "plant_id")
    op.alter_column(table_name, "plant_id_legacy", new_column_name="plant_id", existing_type=sa.String(length=50))


def upgrade() -> None:
    connection = op.get_bind()

    managed_tables = ["item_master", "stock_batch", "stock_transaction", "reservations"]
    for table_name in managed_tables:
        _upgrade_table(connection, table_name)

    if _table_exists(connection, "item_master"):
        connection.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_item_master_plant_id ON item_master(plant_id)"))
    if _table_exists(connection, "stock_batch"):
        connection.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_stock_batch_plant_id ON stock_batch(plant_id)"))
    if _table_exists(connection, "stock_transaction"):
        connection.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_stock_transaction_plant_id ON stock_transaction(plant_id)"))
    if _table_exists(connection, "reservations"):
        connection.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_reservations_plant_id ON reservations(plant_id)"))


def downgrade() -> None:
    connection = op.get_bind()
    if _table_exists(connection, "item_master"):
        connection.execute(sa.text("DROP INDEX IF EXISTS ix_item_master_plant_id"))
    if _table_exists(connection, "stock_batch"):
        connection.execute(sa.text("DROP INDEX IF EXISTS ix_stock_batch_plant_id"))
    if _table_exists(connection, "stock_transaction"):
        connection.execute(sa.text("DROP INDEX IF EXISTS ix_stock_transaction_plant_id"))
    if _table_exists(connection, "reservations"):
        connection.execute(sa.text("DROP INDEX IF EXISTS ix_reservations_plant_id"))

    for table_name in ["reservations", "stock_transaction", "stock_batch", "item_master"]:
        _downgrade_table(connection, table_name)
