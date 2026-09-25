"""purchase and inward metadata

Revision ID: 007_purchase_inward_metadata
Revises: 006_item_tracking_mode
Create Date: 2026-07-03
"""

from alembic import op


revision = "007_purchase_inward_metadata"
down_revision = "006_item_tracking_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Early deployments created the purchase tables through SQLAlchemy startup
    # rather than Alembic. Define their original shape here so a brand-new
    # database and an existing production database both have a valid path.
    op.execute("""CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL DEFAULT 'PLANT_A', po_no VARCHAR(80) NOT NULL,
        supplier_id UUID NOT NULL, supplier_name_snapshot VARCHAR(200) NOT NULL, expected_date DATE,
        status VARCHAR(30) NOT NULL DEFAULT 'DRAFT', notes VARCHAR(500), metadata_json JSONB,
        created_by VARCHAR(200) NOT NULL, approved_by VARCHAR(200), approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(), CONSTRAINT uq_purchase_orders_plant_po UNIQUE (plant_id, po_no),
        CONSTRAINT ck_purchase_orders_status CHECK (status IN ('DRAFT','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'))
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id UUID PRIMARY KEY, purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
        item_id UUID NOT NULL REFERENCES item_master(id), qty_ordered DOUBLE PRECISION NOT NULL,
        qty_received DOUBLE PRECISION NOT NULL DEFAULT 0, unit_cost DOUBLE PRECISION NOT NULL,
        incoming_qc_required BOOLEAN NOT NULL DEFAULT TRUE, line_status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        notes VARCHAR(500), metadata_json JSONB, created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT ck_purchase_order_lines_qty_ordered_positive CHECK (qty_ordered > 0),
        CONSTRAINT ck_purchase_order_lines_qty_received_nonnegative CHECK (qty_received >= 0),
        CONSTRAINT ck_purchase_order_lines_unit_cost_nonnegative CHECK (unit_cost >= 0),
        CONSTRAINT ck_purchase_order_lines_status CHECK (line_status IN ('OPEN','PARTIAL','CLOSED'))
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS purchase_receipts (
        id UUID PRIMARY KEY, plant_id VARCHAR(50) NOT NULL DEFAULT 'PLANT_A',
        purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id), grn_no VARCHAR(80) NOT NULL,
        received_date DATE NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'POSTED',
        created_by VARCHAR(200) NOT NULL, created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_purchase_receipts_plant_grn UNIQUE (plant_id, grn_no)
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
        id UUID PRIMARY KEY, receipt_id UUID NOT NULL REFERENCES purchase_receipts(id),
        purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id),
        item_id UUID NOT NULL REFERENCES item_master(id), batch_id UUID REFERENCES stock_batch(id),
        qty_received DOUBLE PRECISION NOT NULL, unit_cost DOUBLE PRECISION NOT NULL,
        qc_status VARCHAR(20) NOT NULL DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT ck_purchase_receipt_lines_qty_positive CHECK (qty_received > 0),
        CONSTRAINT ck_purchase_receipt_lines_qc_status CHECK (qc_status IN ('PENDING','PASS','HOLD'))
    )""")
    for statement in (
        "CREATE INDEX IF NOT EXISTS ix_purchase_orders_plant_id ON purchase_orders(plant_id)",
        "CREATE INDEX IF NOT EXISTS ix_purchase_orders_supplier_id ON purchase_orders(supplier_id)",
        "CREATE INDEX IF NOT EXISTS ix_purchase_order_lines_order ON purchase_order_lines(purchase_order_id)",
        "CREATE INDEX IF NOT EXISTS ix_purchase_order_lines_item ON purchase_order_lines(item_id)",
        "CREATE INDEX IF NOT EXISTS ix_purchase_receipts_order ON purchase_receipts(purchase_order_id)",
        "CREATE INDEX IF NOT EXISTS ix_purchase_receipt_lines_receipt ON purchase_receipt_lines(receipt_id)",
    ):
        op.execute(statement)
    op.execute("ALTER TABLE stock_batch ADD COLUMN IF NOT EXISTS inward_metadata JSONB")
    op.execute("ALTER TABLE paper_reels ADD COLUMN IF NOT EXISTS inward_metadata JSONB")
    op.execute("ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS metadata_json JSONB")
    op.execute("ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS metadata_json JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE purchase_order_lines DROP COLUMN IF EXISTS metadata_json")
    op.execute("ALTER TABLE purchase_orders DROP COLUMN IF EXISTS metadata_json")
    op.execute("ALTER TABLE paper_reels DROP COLUMN IF EXISTS inward_metadata")
    op.execute("ALTER TABLE stock_batch DROP COLUMN IF EXISTS inward_metadata")
