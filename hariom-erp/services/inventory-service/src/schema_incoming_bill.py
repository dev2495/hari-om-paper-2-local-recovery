"""Data side of release 013_incoming_bill_qc (6 Nov 2026). Idempotent; runs at every start.

1. Every incoming QC template check is optional; the typed weight checks are retired (paper
   ``reel_weight_kg``, parchment ``weight_kg``): the actual weight is now built into the bill sheet.
2. Readings already typed in those weight checks are copied into the lot's ``actual_qty`` (only where it is
   still empty). No stock posting: stock stays on the bill weight, and no weight case is raised for them.
3. Lots still waiting in QC carry a frozen copy of their standard; their checks become optional too, so a
   blank check no longer saves the lot as INCOMPLETE.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text

from .quality_templates import INCOMING_OPTIONAL_TYPES, RETIRED_WEIGHT_PARAMETERS

log = logging.getLogger(__name__)

HISTORY_NOTE = "Copied from the QC weight reading (before bill-wise weigh-in)"
_RETIRED_CODES = {code for _, code in RETIRED_WEIGHT_PARAMETERS}

# Inward QC by bill: the purchase case key moves from (allocation, type) to (allocation, type, source).
# Drops the old pair key whatever it is called (a constraint, or a bare unique index). Run after the new
# triple index exists; rows unique on the pair are unique on the triple, so no row changes.
DROP_OLD_DISCREPANCY_KEY_SQL = """
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname AS name FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'purchase_discrepancies' AND rel.relnamespace = to_regnamespace(current_schema())
      AND con.contype = 'u'
      AND (SELECT array_agg(att.attname::text ORDER BY att.attname) FROM unnest(con.conkey) AS k(n)
           JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.n) = ARRAY['allocation_id', 'discrepancy_type']
  LOOP
    EXECUTE format('ALTER TABLE purchase_discrepancies DROP CONSTRAINT %I', r.name);
  END LOOP;
  FOR r IN
    SELECT idx.relname AS name FROM pg_index x JOIN pg_class idx ON idx.oid = x.indexrelid JOIN pg_class tbl ON tbl.oid = x.indrelid
    WHERE tbl.relname = 'purchase_discrepancies' AND tbl.relnamespace = to_regnamespace(current_schema())
      AND x.indisunique AND NOT x.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)
      AND (SELECT array_agg(att.attname::text ORDER BY att.attname) FROM unnest(x.indkey::int2[]) AS k(n)
           JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.n) = ARRAY['allocation_id', 'discrepancy_type']
  LOOP
    EXECUTE format('DROP INDEX %I', r.name);
  END LOOP;
END $$
"""


def relax_profile(profile: Any) -> tuple[Any, bool]:
    """A frozen incoming standard with every check optional and the retired weight checks off."""
    if not isinstance(profile, dict) or not isinstance(profile.get("parameters"), list):
        return profile, False
    changed = False
    rows = []
    for row in profile["parameters"]:
        if not isinstance(row, dict):
            rows.append(row)
            continue
        updated = dict(row)
        if updated.get("required") is not False:
            updated["required"] = False
            changed = True
        if str(updated.get("code") or updated.get("parameter_key") or "") in _RETIRED_CODES and updated.get("applicable") is not False:
            updated["applicable"] = False
            changed = True
        rows.append(updated)
    if not changed:
        return profile, False
    return {**profile, "parameters": rows, "checks_optional": True}, True


def relax_lot_metadata(metadata: Any) -> tuple[Any, bool]:
    if not isinstance(metadata, dict):
        return metadata, False
    profile, changed = relax_profile(metadata.get("quality_profile"))
    if not changed:
        return metadata, False
    return {**metadata, "quality_profile": profile}, True


_COPY_SQL = """
WITH readings AS (
  SELECT DISTINCT ON (i.entity_type, i.entity_id)
         i.entity_type, i.entity_id, i.created_at, i.created_by,
         btrim(COALESCE(NULLIF(btrim(i.readings->>'reel_weight_kg'), ''), NULLIF(btrim(i.readings->>'weight_kg'), ''))) AS reading
  FROM inventory_quality_inspections i
  WHERE i.entity_type = :entity_type
    AND (COALESCE(btrim(i.readings->>'reel_weight_kg'), '') <> '' OR COALESCE(btrim(i.readings->>'weight_kg'), '') <> '')
  ORDER BY i.entity_type, i.entity_id, i.created_at DESC
)
UPDATE {table} lot
SET actual_qty = round(CAST(x.reading AS numeric), 3), weighed_at = x.created_at, weighed_by = x.created_by, weigh_note = :note
FROM readings x
WHERE x.entity_id = lot.id AND lot.actual_qty IS NULL
  AND x.reading ~ '^[0-9]+([.][0-9]+)?$' AND CAST(x.reading AS numeric) > 0 AND CAST(x.reading AS numeric) < 10000000
"""


def migrate_incoming_bill_qc_data(connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    counts["templates_optional"] = int(connection.execute(text(
        "UPDATE inventory_quality_templates SET required = false WHERE required AND material_type = ANY(:types)"
    ), {"types": list(INCOMING_OPTIONAL_TYPES)}).rowcount or 0)
    retired = 0
    for material_type, code in RETIRED_WEIGHT_PARAMETERS:
        retired += int(connection.execute(text(
            "UPDATE inventory_quality_templates SET active = 'false' "
            "WHERE material_type = :material_type AND parameter_key = :code AND active = 'true'"
        ), {"material_type": material_type, "code": code}).rowcount or 0)
    counts["templates_retired"] = retired
    counts["reels_copied"] = int(connection.execute(text(_COPY_SQL.format(table="paper_reels")),
                                                    {"entity_type": "REEL", "note": HISTORY_NOTE}).rowcount or 0)
    counts["batches_copied"] = int(connection.execute(text(_COPY_SQL.format(table="stock_batch")),
                                                      {"entity_type": "BATCH", "note": HISTORY_NOTE}).rowcount or 0)
    relaxed = 0
    for table in ("paper_reels", "stock_batch"):
        rows = connection.execute(text(
            f"SELECT id, inward_metadata FROM {table} "
            "WHERE stock_status IN ('QC_HOLD','BLOCKED') AND inward_metadata IS NOT NULL"
        )).all()
        for lot_id, raw in rows:
            metadata = raw if isinstance(raw, dict) else (json.loads(raw) if isinstance(raw, str) and raw else None)
            updated, changed = relax_lot_metadata(metadata)
            if changed:
                connection.execute(text(f"UPDATE {table} SET inward_metadata = CAST(:meta AS JSON) WHERE id = :id"),
                                   {"meta": json.dumps(updated, default=str), "id": lot_id})
                relaxed += 1
    counts["held_lot_profiles_relaxed"] = relaxed
    if any(counts.values()):
        print(f"[schema-compat] incoming bill QC: {counts}")
    return counts
