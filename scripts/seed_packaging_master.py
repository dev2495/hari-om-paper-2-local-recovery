#!/usr/bin/env python3
"""Idempotent packaging master seed for spec-sheet dropdown recovery."""

from __future__ import annotations

import os
import uuid
from typing import Iterable

import psycopg2
from psycopg2.extras import DictCursor


DEFAULT_BOXES = [
    {
        "code": "R-150",
        "length_mm": 680.0,
        "width_mm": 370.0,
        "height_mm": 460.0,
        "size_label": "680X370X460",
        "weight_kg": 0.0,
    },
    {
        "code": "G-120",
        "length_mm": 560.0,
        "width_mm": 420.0,
        "height_mm": 490.0,
        "size_label": "560X420X490",
        "weight_kg": 0.0,
    },
]

DEFAULT_PLASTICS = [
    {"sku": "PL-680", "size_label": "680X370", "weight_kg": 0.0},
    {"sku": "PL-560", "size_label": "560X420", "weight_kg": 0.0},
]

DEFAULT_FADDA = [
    {"sku": "FAD-01", "weight_kg": 0.0},
    {"sku": "FAD-09", "weight_kg": 0.0},
]


def _db_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "5432")),
        user=os.getenv("DB_USER", os.getenv("USER", "postgres")),
        password=os.getenv("DB_PASSWORD", ""),
        dbname=os.getenv("MASTER_DB_NAME", "masterdb"),
    )


def _resolve_plants(cur) -> list[str]:
    cur.execute(
        """
        SELECT DISTINCT plant_id
        FROM (
          SELECT plant_id FROM paper_master
          UNION ALL SELECT plant_id FROM mandrel
          UNION ALL SELECT plant_id FROM tube_size
          UNION ALL SELECT plant_id FROM customer
        ) plants
        WHERE plant_id IS NOT NULL AND plant_id <> ''
        ORDER BY 1
        """
    )
    rows = [str(row[0]) for row in cur.fetchall() if row[0]]
    if rows:
        return rows
    return [
        "00000000-0000-0000-0000-0000000000a1",
        "00000000-0000-0000-0000-0000000000b2",
    ]


def _upsert_boxes(cur, plant_ids: Iterable[str]) -> int:
    count = 0
    for plant_id in plant_ids:
        for row in DEFAULT_BOXES:
            cur.execute(
                """
                INSERT INTO packaging_box
                    (id, code, length_mm, width_mm, height_mm, size_label, weight_kg, plant_id, active)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (plant_id, code)
                DO UPDATE SET
                    length_mm = EXCLUDED.length_mm,
                    width_mm = EXCLUDED.width_mm,
                    height_mm = EXCLUDED.height_mm,
                    size_label = EXCLUDED.size_label,
                    weight_kg = EXCLUDED.weight_kg,
                    active = TRUE
                """,
                (
                    str(uuid.uuid4()),
                    row["code"],
                    row["length_mm"],
                    row["width_mm"],
                    row["height_mm"],
                    row["size_label"],
                    row["weight_kg"],
                    plant_id,
                ),
            )
            count += 1
    return count


def _upsert_plastics(cur, plant_ids: Iterable[str]) -> int:
    count = 0
    for plant_id in plant_ids:
        for row in DEFAULT_PLASTICS:
            cur.execute(
                """
                INSERT INTO packaging_plastic_sheet
                    (id, sku, size_label, weight_kg, plant_id, active)
                VALUES
                    (%s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (plant_id, sku)
                DO UPDATE SET
                    size_label = EXCLUDED.size_label,
                    weight_kg = EXCLUDED.weight_kg,
                    active = TRUE
                """,
                (
                    str(uuid.uuid4()),
                    row["sku"],
                    row["size_label"],
                    row["weight_kg"],
                    plant_id,
                ),
            )
            count += 1
    return count


def _upsert_fadda(cur, plant_ids: Iterable[str]) -> int:
    count = 0
    for plant_id in plant_ids:
        for row in DEFAULT_FADDA:
            cur.execute(
                """
                INSERT INTO packaging_fadda
                    (id, sku, weight_kg, plant_id, active)
                VALUES
                    (%s, %s, %s, %s, TRUE)
                ON CONFLICT (plant_id, sku)
                DO UPDATE SET
                    weight_kg = EXCLUDED.weight_kg,
                    active = TRUE
                """,
                (
                    str(uuid.uuid4()),
                    row["sku"],
                    row["weight_kg"],
                    plant_id,
                ),
            )
            count += 1
    return count


def main() -> int:
    with _db_conn() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            plants = _resolve_plants(cur)
            boxes = _upsert_boxes(cur, plants)
            plastics = _upsert_plastics(cur, plants)
            fadda = _upsert_fadda(cur, plants)
        conn.commit()
    print(f"seeded packaging masters | plants={len(plants)} boxes={boxes} plastics={plastics} fadda={fadda}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
