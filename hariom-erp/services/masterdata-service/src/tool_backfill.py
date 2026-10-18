"""Tools named in specification sheets exist in the Tool master (client 2026-10-18)."""
from __future__ import annotations

import logging
import os
import uuid

from sqlalchemy import create_engine, text

from .database import DATABASE_URL, engine
from .utils.auth import get_plant_aliases

log = logging.getLogger(__name__)
# Spec-sheet notch fields -> Tool master category (same map the spec sheet uses to link a tool).
SPEC_TOOL_FIELDS = {"notch_type": "NOTCH", "notching_blade": "BLADE", "notching_holder": "HOLDER", "v_flat": "V_FLAT", "punch": "PUNCH"}


def spec_database_url() -> str | None:
    explicit = os.getenv("SPEC_DATABASE_URL")
    if explicit:
        return explicit
    # Every service database sits on the same server, named <prefix>masterdb / <prefix>specdb.
    head, sep, name = DATABASE_URL.rpartition("/")
    base, _, query = name.partition("?")
    if not sep or not base.endswith("masterdb"):
        return None
    return f"{head}/{base[: -len('masterdb')]}specdb" + (f"?{query}" if query else "")


def backfill_tools_from_specs() -> int:
    """Every tool a specification sheet names exists in the Tool master (client 2026-10-18:
    imported specs showed "Notch tools not in Tool master" and empty tool dropdowns).

    Reads the spec database once at start, creates only the missing (category, name) pairs in
    the spec's plant, and never touches an existing row, so a tool QC switched off stays off."""
    url = spec_database_url()
    if not url:
        return 0
    spec_engine = None
    try:
        spec_engine = create_engine(url, pool_pre_ping=True)
        with spec_engine.connect() as connection:
            rows = connection.execute(text(
                "SELECT f.key, btrim(v.value), v.plant_id FROM spec_dynamic_field_values v "
                "JOIN spec_dynamic_fields f ON f.id = v.field_id "
                "WHERE f.key = ANY(:keys) AND coalesce(btrim(v.value), '') <> ''"
            ), {"keys": list(SPEC_TOOL_FIELDS)}).all()
    except Exception as exc:  # spec database not reachable (tests, first boot): skip quietly
        log.warning("Tool backfill from specs skipped: %s", type(exc).__name__)
        return 0
    finally:
        if spec_engine is not None:
            spec_engine.dispose()
    wanted: dict[tuple[str, str, str], str] = {}
    for key, value, plant_id in rows:
        name = str(value or "").strip()[:150]
        if not name or name.lower() in {"na", "n/a", "none", "-"}:
            continue
        category = SPEC_TOOL_FIELDS[key]
        plant = str(plant_id or "PLANT_A").strip() or "PLANT_A"
        wanted.setdefault((category, name.casefold(), plant), name)
    if not wanted:
        return 0
    created = 0
    with engine.begin() as connection:
        for (category, folded, plant), name in wanted.items():
            aliases = get_plant_aliases(plant) or [plant]
            exists = connection.execute(text(
                "SELECT 1 FROM tool_master WHERE category = :category AND lower(btrim(name)) = :name AND plant_id = ANY(:plants) LIMIT 1"
            ), {"category": category, "name": folded, "plants": aliases}).first()
            if exists:
                continue
            connection.execute(text(
                "INSERT INTO tool_master (id, category, name, spec_text, department, plant_id, status, usage_count, active, created_at, updated_at, attribute_values) "
                "VALUES (:id, :category, :name, :spec_text, 'COMMON', :plant, 'ACTIVE', 0, TRUE, NOW(), NOW(), CAST(:attrs AS JSON)) "
                "ON CONFLICT DO NOTHING"
            ), {"id": str(uuid.uuid4()), "category": category, "name": name, "spec_text": "Added from specification sheets", "plant": plant, "attrs": "{}"})
            created += 1
    if created:
        log.info("Tool master: added %s tool(s) named in specification sheets", created)
    return created


