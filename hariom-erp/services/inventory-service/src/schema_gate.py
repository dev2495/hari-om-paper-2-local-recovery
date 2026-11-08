"""Goods out: the watchman only photographs, Store links (owner correction, 8 Nov 2026; alembic 016).

Run at every inventory-service start (``src/main.py``) after ``create_all``. Idempotent and safe on a
populated database:

- one goods-out gate entry may now cover several challans, so ``dispatch_gate_out`` loses its unique key on
  ``gate_entry_id`` (a plain index replaces it); ``dispatch_ref`` stays unique per plant;
- ``dispatch_gate_out`` gains ``linked_by`` / ``linked_at`` (the Store user who linked the photos);
- rows made by the 7 Nov release (the watchman picked the challan and typed the Tally no.) are already
  linked: their gate entries move from status OUT to LINKED and their link fields are filled from the
  entry. Nothing else changes; a second run finds nothing to do.
"""
from __future__ import annotations

GATE_GOODS_OUT_SCHEMA_STATEMENTS = (
    "ALTER TABLE IF EXISTS dispatch_gate_out ADD COLUMN IF NOT EXISTS linked_by VARCHAR(200)",
    "ALTER TABLE IF EXISTS dispatch_gate_out ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP",
    "ALTER TABLE IF EXISTS dispatch_gate_out DROP CONSTRAINT IF EXISTS uq_dispatch_gate_out_entry",
    "DROP INDEX IF EXISTS uq_dispatch_gate_out_entry",
    "CREATE INDEX IF NOT EXISTS ix_dispatch_gate_out_gate_entry_id ON dispatch_gate_out (gate_entry_id)",
    # 7 Nov rows: linked by the watchman at the gate when the truck left.
    "UPDATE dispatch_gate_out SET linked_at = out_at, linked_by = out_by "
    "WHERE linked_at IS NULL AND out_at IS NOT NULL AND gate_entry_id IS NOT NULL",
    "UPDATE gate_entries SET status = 'LINKED', linked_at = COALESCE(linked_at, created_at), "
    "linked_by = COALESCE(linked_by, created_by), version = version + 1 "
    "WHERE kind = 'GOODS_OUT' AND status = 'OUT'",
)
