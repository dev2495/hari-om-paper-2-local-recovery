"""Use one supplier commitment and receipt-allocation ledger."""
from alembic import op
import sqlalchemy as sa
revision = "011_canonical_supplier_schedule"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT to_regclass('purchase_delivery_schedules')")).scalar():
        if connection.execute(sa.text("SELECT EXISTS(SELECT 1 FROM purchase_delivery_schedules)")).scalar():
            raise RuntimeError("Legacy procurement schedules exist. Reconcile their receipt allocations before using the canonical calendar.")
    op.execute("""CREATE TABLE IF NOT EXISTS purchase_line_schedules (
        id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL,
        purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id),
        scheduled_qty DOUBLE PRECISION NOT NULL CHECK(scheduled_qty > 0),
        promised_date DATE NOT NULL, current_expected_date DATE NOT NULL,
        confirmation_status VARCHAR(20) NOT NULL DEFAULT 'TENTATIVE', notes VARCHAR(500),
        created_by VARCHAR(200) NOT NULL, created_at TIMESTAMP, cancelled_at TIMESTAMP)""")
    op.execute("""CREATE TABLE IF NOT EXISTS receipt_schedule_allocations (
        id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL,
        receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id),
        schedule_id UUID NOT NULL REFERENCES purchase_line_schedules(id),
        allocated_qty DOUBLE PRECISION NOT NULL CHECK(allocated_qty > 0), created_at TIMESTAMP)""")
    for statement in (
        "ALTER TABLE purchase_line_schedules ADD COLUMN IF NOT EXISTS revision_line_id UUID REFERENCES purchase_order_revision_lines(id)",
        "ALTER TABLE purchase_line_schedules ADD COLUMN IF NOT EXISTS source_plan_entry_id UUID",
        "ALTER TABLE purchase_line_schedules ADD COLUMN IF NOT EXISTS cancelled_qty DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE purchase_line_schedules ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE receipt_schedule_allocations DROP CONSTRAINT IF EXISTS uq_receipt_schedule_alloc_receipt_line",
        "DROP INDEX IF EXISTS uq_receipt_schedule_alloc_receipt_line",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_schedule_alloc_pair ON receipt_schedule_allocations(receipt_line_id, schedule_id)",
    ):
        op.execute(statement)


def downgrade():
    raise RuntimeError("Forward recovery required: split receipt allocations must be preserved")
