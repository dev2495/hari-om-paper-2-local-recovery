"""Real no-PO receipts with explicit maker/checker history.

Revision ID: 010
Revises: 009
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "010"
down_revision = "009_procurement_control_suite"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("purchase_receipts", "purchase_order_id", nullable=True)
    op.alter_column("purchase_receipt_lines", "purchase_order_line_id", nullable=True)
    op.add_column("purchase_receipts", sa.Column("supplier_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_purchase_receipts_supplier_id", "purchase_receipts", ["supplier_id"])
    op.add_column("purchase_receipts", sa.Column("supplier_name_snapshot", sa.String(200), nullable=True))
    op.add_column("purchase_receipts", sa.Column("receipt_kind", sa.String(20), nullable=False, server_default="PO_LINKED"))
    op.add_column("purchase_receipts", sa.Column("manual_reason", sa.Text(), nullable=True))
    op.add_column("purchase_receipts", sa.Column("approval_history", postgresql.JSONB(), nullable=False, server_default="[]"))
    op.execute("UPDATE purchase_receipts r SET supplier_id=o.supplier_id, supplier_name_snapshot=o.supplier_name_snapshot FROM purchase_orders o WHERE o.id=r.purchase_order_id")


def downgrade():
    # A downgrade cannot silently destroy genuine no-PO commercial history.
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT EXISTS(SELECT 1 FROM purchase_receipts WHERE purchase_order_id IS NULL)")).scalar():
        raise RuntimeError("Manual receipts exist; archive/export and use a forward recovery migration")
    for name in ("approval_history", "manual_reason", "receipt_kind", "supplier_name_snapshot"):
        op.drop_column("purchase_receipts", name)
    op.drop_index("ix_purchase_receipts_supplier_id", table_name="purchase_receipts")
    op.drop_column("purchase_receipts", "supplier_id")
    op.alter_column("purchase_receipt_lines", "purchase_order_line_id", nullable=False)
    op.alter_column("purchase_receipts", "purchase_order_id", nullable=False)
