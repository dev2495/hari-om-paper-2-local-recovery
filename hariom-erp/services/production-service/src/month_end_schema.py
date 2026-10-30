"""Month-end close schema (client 2026-10-28).

The close row keeps a frozen snapshot plus who closed / re-opened it and why; monthly_close_events is
the close history; monthly_material_notes holds one note per plant + month + item; plant_usage_limits
holds the usage limits per material type. New tables come from create_all; these statements add the
columns on existing tables and copy old data once (each backfill is guarded, so a restart never
repeats it). Kept apart from main.py so tests can run the backfills on their own.
"""
from __future__ import annotations

from sqlalchemy import text

MONTH_END_CLOSE_MIGRATIONS = [
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS closed_by VARCHAR(200)",
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP",
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS close_note TEXT",
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS snapshot JSONB",
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMP",
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS reopened_by VARCHAR(200)",
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMP",
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS reopen_reason TEXT",
    "ALTER TABLE monthly_material_close ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
    "CREATE INDEX IF NOT EXISTS ix_monthly_material_close_plant_month ON monthly_material_close (plant_id, month_start)",
    # Months approved before this release count as closed by their approver (no frozen figures).
    "UPDATE monthly_material_close SET closed_by = approved_by, closed_at = COALESCE(approved_at, locked_at), "
    "close_note = COALESCE(close_note, notes) WHERE status = 'APPROVED' AND closed_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_monthly_close_events_plant_month ON monthly_close_events (plant_id, month_start, created_at)",
    "INSERT INTO monthly_close_events (id, plant_id, month_start, event, actor, reason, details, created_at) "
    "SELECT gen_random_uuid(), c.plant_id, c.month_start, 'CLOSED', c.approved_by, c.notes, "
    "jsonb_build_object('backfilled', true), COALESCE(c.approved_at, c.locked_at, c.updated_at, now()) "
    "FROM monthly_material_close c WHERE c.status = 'APPROVED' AND NOT EXISTS ("
    "SELECT 1 FROM monthly_close_events e WHERE e.plant_id = c.plant_id AND e.month_start = c.month_start)",
    # Notes typed on the old Actual entry page become per-item notes; machine-written
    # "Stock count …" fill-ins are not explanations and stay behind. Runs only while the table is empty.
    "INSERT INTO monthly_material_notes (id, plant_id, month_start, item_code, item_name, note, noted_by, noted_at, created_at, updated_at) "
    "SELECT gen_random_uuid(), a.plant_id, a.month_start, a.item_code, a.item_name, a.note, a.created_by, a.created_at, now(), now() "
    "FROM (SELECT DISTINCT ON (plant_id, month_start, item_code) plant_id, month_start, item_code, item_name, "
    "      btrim(notes) AS note, created_by, created_at FROM monthly_material_actuals "
    "      WHERE notes IS NOT NULL AND btrim(notes) <> '' AND btrim(notes) NOT LIKE 'Stock count %' "
    "      ORDER BY plant_id, month_start, item_code, created_at DESC) a "
    "WHERE NOT EXISTS (SELECT 1 FROM monthly_material_notes) "
    "ON CONFLICT (plant_id, month_start, item_code) DO NOTHING",
    # A plant's saved kg bands become its minimum gap and its paper allowance its normal wastage
    # (the factor won over the % before, so it is read first). Runs only while the table is empty.
    "INSERT INTO plant_usage_limits (id, plant_id, material_type, normal_wastage_pct, allowed_gap_pct, min_gap, updated_by, created_at, updated_at) "
    "SELECT gen_random_uuid(), t.plant_id, v.material_type, "
    "CASE WHEN v.material_type = 'RAW_PAPER' THEN COALESCE(round(((t.paper_expected_consumption_factor - 1) * 100)::numeric, 3)::float, "
    "t.paper_standard_wastage_percent, 7) ELSE 0 END, 7, "
    "COALESCE(CASE v.material_type WHEN 'RAW_PAPER' THEN t.raw_paper_kg WHEN 'ADHESIVE' THEN t.adhesive_kg "
    "WHEN 'PARCHMENT' THEN t.parchment_kg WHEN 'PACKAGING' THEN t.packaging_kg ELSE t.default_kg END, v.min_gap), "
    "COALESCE(t.updated_by, 'migration'), now(), now() "
    "FROM plant_tolerance_setting t CROSS JOIN (VALUES ('RAW_PAPER', 5.0::float), ('ADHESIVE', 0.5::float), "
    "('PARCHMENT', 1.0::float), ('PACKAGING', 10.0::float), ('OTHER', 5.0::float)) AS v(material_type, min_gap) "
    "WHERE NOT EXISTS (SELECT 1 FROM plant_usage_limits) "
    "ON CONFLICT (plant_id, material_type) DO NOTHING",
]


def run_month_end_close_migrations(engine) -> None:
    """Each statement in its own transaction; a failure is printed and the rest still run."""
    for statement in MONTH_END_CLOSE_MIGRATIONS:
        try:
            with engine.begin() as connection:
                connection.execute(text(statement))
        except Exception as exc:  # pragma: no cover - defensive migration guard
            print(f"[schema-compat] skipped statement: {statement!r} ({exc})")
