"""Goods out: the watchman only photographs, Store links the challans and the Tally bill no. (8 Nov 2026).

One goods-out gate entry may cover several challans: ``dispatch_gate_out`` drops its unique key on
``gate_entry_id`` (plain index instead) and gains ``linked_by`` / ``linked_at``. Rows of the 7 Nov release
(already linked at the gate) become LINKED. On live the service runs the same statements at startup
(``src/schema_gate.py`` from ``src/main.py``). Idempotent.
"""
from alembic import op

revision = "016_gate_goods_out_link"
down_revision = "015_gate"
branch_labels = None
depends_on = None

STATEMENTS = (
    "ALTER TABLE IF EXISTS dispatch_gate_out ADD COLUMN IF NOT EXISTS linked_by VARCHAR(200)",
    "ALTER TABLE IF EXISTS dispatch_gate_out ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP",
    "ALTER TABLE IF EXISTS dispatch_gate_out DROP CONSTRAINT IF EXISTS uq_dispatch_gate_out_entry",
    "DROP INDEX IF EXISTS uq_dispatch_gate_out_entry",
    "CREATE INDEX IF NOT EXISTS ix_dispatch_gate_out_gate_entry_id ON dispatch_gate_out (gate_entry_id)",
    "UPDATE dispatch_gate_out SET linked_at = out_at, linked_by = out_by "
    "WHERE linked_at IS NULL AND out_at IS NOT NULL AND gate_entry_id IS NOT NULL",
    "UPDATE gate_entries SET status = 'LINKED', linked_at = COALESCE(linked_at, created_at), "
    "linked_by = COALESCE(linked_by, created_by), version = version + 1 "
    "WHERE kind = 'GOODS_OUT' AND status = 'OUT'",
)


def upgrade():
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade():
    # Columns and the index stay (the older code ignores them). The unique key on gate_entry_id cannot come
    # back while an entry covers two challans, so it is not recreated here.
    pass
