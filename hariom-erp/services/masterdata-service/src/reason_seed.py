"""Standard reasons for cancelling or short-closing a sales order (client 2026-10-20).

Category SO_CLOSE ("Order cancel / short close") in Masters › Reason codes. Every plant that has
master data gets these once, so the cancel / short-close dialog never starts empty; after that the
plant edits, disables or adds its own and nothing here touches them again.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import text

from .database import engine
from .utils.auth import get_plant_aliases

log = logging.getLogger(__name__)
CATEGORY = "SO_CLOSE"
DEFAULT_REASONS = (
    ("SO-CUST-CANCEL", "Customer cancelled the order"),
    ("SO-QTY-REDUCED", "Customer reduced the quantity"),
    ("SO-BALANCE-NOT-REQ", "Customer does not need the balance"),
    ("SO-SPEC-CHANGE", "Customer changed the specification"),
    ("SO-PRICE", "Price or terms not agreed"),
    ("SO-PO-EXPIRED", "PO validity expired"),
    ("SO-DUPLICATE", "Duplicate order entry"),
    ("SO-ENTRY-ERROR", "Order entered by mistake"),
    ("SO-OTHER", "Other (write a note)"),
)
_PLANT_TABLES = ("customer", "paper_master", "machine", "reason_code")


def seed_order_close_reasons() -> int:
    """Insert the standard SO_CLOSE reasons for each plant that has none yet (any alias of it)."""
    created = 0
    try:
        with engine.begin() as connection:
            plants: list[str] = []
            for table in _PLANT_TABLES:
                try:
                    plants += [row[0] for row in connection.execute(text(f"SELECT DISTINCT plant_id FROM {table} WHERE plant_id IS NOT NULL"))]
                except Exception:  # table not created yet on a fresh database
                    continue
            done: set[str] = set()
            for plant in sorted({str(value).strip() for value in plants if str(value or "").strip()}):
                aliases = get_plant_aliases(plant)
                if done & set(aliases):
                    continue
                done.update(aliases)
                existing = connection.execute(
                    text("SELECT code, category FROM reason_code WHERE plant_id = ANY(:aliases)"),
                    {"aliases": aliases},
                ).fetchall()
                if any(row[1] == CATEGORY for row in existing):
                    continue
                taken = {row[0] for row in existing}
                for code, label in DEFAULT_REASONS:
                    if code in taken:
                        continue
                    connection.execute(
                        text(
                            "INSERT INTO reason_code (id, code, label, category, severity, description, plant_id, active, created_at, updated_at) "
                            "VALUES (:id, :code, :label, :category, 'WATCH', :description, :plant_id, TRUE, NOW(), NOW()) "
                            "ON CONFLICT (plant_id, code) DO NOTHING"
                        ),
                        {"id": str(uuid.uuid4()), "code": code, "label": label, "category": CATEGORY,
                         "description": "Standard reason for cancelling or short-closing a sales order", "plant_id": plant},
                    )
                    created += 1
    except Exception:  # pragma: no cover - never block start-up
        log.warning("order close reason seeding failed", exc_info=True)
    if created:
        log.info("seeded %s order cancel / short close reasons", created)
    return created
