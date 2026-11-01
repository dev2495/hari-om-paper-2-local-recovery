"""Standard reason codes for every reason list (client 2026-10-20 for SO_CLOSE; owner decision 4, 1 Nov 2026
for every other list).

Every plant that has master data gets the standard codes of each category in ``reason_catalog`` once, so
no reason picker starts empty. ``reason_seed_log`` remembers which (plant, category) pairs were seeded:
after that the plant edits, disables or adds its own codes and nothing here touches that list again.
A code the plant already has (in any list) is never inserted twice or changed.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import text

from .database import engine
from .reason_catalog import CATEGORIES
from .utils.auth import get_plant_aliases

log = logging.getLogger(__name__)
CATEGORY = "SO_CLOSE"
DEFAULT_REASONS = tuple(next(row for row in CATEGORIES if row["key"] == CATEGORY)["seeds"])
_PLANT_TABLES = ("customer", "paper_master", "machine", "reason_code")


def _plants(connection) -> list[str]:
    plants: list[str] = []
    for table in _PLANT_TABLES:
        try:
            with connection.begin_nested():
                plants += [row[0] for row in connection.execute(text(f"SELECT DISTINCT plant_id FROM {table} WHERE plant_id IS NOT NULL"))]
        except Exception:  # table not created yet on a fresh database
            continue
    return sorted({str(value).strip() for value in plants if str(value or "").strip()})


def plan_seed_rows(existing: list[tuple[str, str]], seeded_categories: set[str]) -> list[tuple[str, str, str]]:
    """(category, code, label) rows to insert for one plant.

    ``existing`` is (code, category) of every reason the plant has; ``seeded_categories`` the lists
    already seeded once. SO_CLOSE keeps its original rule too: a plant that already has any order close
    reason is not given the standard ones again.
    """
    taken = {str(code or "").strip().upper() for code, _ in existing}
    has_category = {str(category or "").strip().upper() for _, category in existing}
    out: list[tuple[str, str, str]] = []
    for row in CATEGORIES:
        key = row["key"]
        if key in seeded_categories or not row["seeds"]:
            continue
        if key == CATEGORY and key in has_category:
            continue
        for code, label in row["seeds"]:
            if code.upper() in taken:
                continue
            taken.add(code.upper())
            out.append((key, code, label))
    return out


_LOG_DDL = (
    "CREATE TABLE IF NOT EXISTS reason_seed_log ("
    " plant_id VARCHAR(50) NOT NULL, category VARCHAR(40) NOT NULL,"
    " seeded_at TIMESTAMP NOT NULL DEFAULT NOW(), PRIMARY KEY (plant_id, category))"
)
# Plants (by alias) already checked by this process: the first-use check below costs nothing after that.
_checked: set[str] = set()


def _seed_plant(connection, plant: str, aliases: list[str]) -> int:
    """Insert the standard codes of every not-yet-seeded category for one plant; returns rows inserted."""
    created = 0
    existing = [(row[0], row[1]) for row in connection.execute(
        text("SELECT code, category FROM reason_code WHERE plant_id = ANY(:aliases)"), {"aliases": aliases},
    )]
    seeded = {str(row[0]).upper() for row in connection.execute(
        text("SELECT category FROM reason_seed_log WHERE plant_id = ANY(:aliases)"), {"aliases": aliases},
    )}
    for category, code, label in plan_seed_rows(existing, seeded):
        result = connection.execute(
            text(
                "INSERT INTO reason_code (id, code, label, category, severity, description, plant_id, active, created_at, updated_at) "
                "VALUES (:id, :code, :label, :category, 'WATCH', :description, :plant_id, TRUE, NOW(), NOW()) "
                "ON CONFLICT (plant_id, code) DO NOTHING"
            ),
            {"id": str(uuid.uuid4()), "code": code, "label": label, "category": category,
             "description": "Standard reason (seeded)", "plant_id": plant},
        )
        created += int(result.rowcount or 0)
    for row in CATEGORIES:
        if row["seeds"] and row["key"] not in seeded:
            connection.execute(
                text("INSERT INTO reason_seed_log (plant_id, category) VALUES (:plant_id, :category) ON CONFLICT DO NOTHING"),
                {"plant_id": plant, "category": row["key"]},
            )
    return created


def seed_reason_codes() -> int:
    """Insert the standard codes of every category for each plant not yet seeded (any alias of it)."""
    created = 0
    try:
        with engine.begin() as connection:
            connection.execute(text(_LOG_DDL))
            done: set[str] = set()
            for plant in _plants(connection):
                aliases = get_plant_aliases(plant) or [plant]
                if done & set(aliases):
                    continue
                done.update(aliases)
                created += _seed_plant(connection, plant, aliases)
    except Exception:  # pragma: no cover - never block start-up
        log.warning("reason code seeding failed", exc_info=True)
    if created:
        log.info("seeded %s standard reason codes", created)
    return created


def ensure_plant_reason_codes(plant_id) -> int:
    """First use of a plant's reason lists (verification issue #12, 1 Nov 2026): a plant added after masterdata
    started (System › Plants) gets the standard codes the first time any of its reason lists is read or checked,
    not only at the next restart. Same seed log, so a plant's own edits are never overwritten."""
    plant = str(plant_id or "").strip()
    if not plant or plant.upper() == "ALL":
        return 0
    aliases = get_plant_aliases(plant) or [plant]
    if _checked & set(aliases):
        return 0
    created = 0
    try:
        with engine.begin() as connection:
            connection.execute(text(_LOG_DDL))
            # Two first uses at once: one seeds, the other waits and then finds the seed log written.
            connection.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "reason-seed:" + min(a.upper() for a in aliases)})
            created = _seed_plant(connection, plant, aliases)
        _checked.update(aliases)
    except Exception:  # never block a reason list; the next call tries again
        log.warning("reason code seeding for plant %s failed", plant, exc_info=True)
    if created:
        log.info("seeded %s standard reason codes for plant %s on first use", created, plant)
    return created


def seed_order_close_reasons() -> int:
    """Kept for callers of the 20 Oct name: seeds every list now."""
    return seed_reason_codes()
