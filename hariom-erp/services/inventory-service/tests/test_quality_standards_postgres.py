"""Inward QC standards (client rule 2026-10-18): QC owns the check list per material type,
Masters own the bands per line / group / type; the item profile is derived and versioned."""
import os
import uuid

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.database import SessionLocal
from src.models import InventoryQualityTemplate, ItemMaster
from src.quality_eval import evaluate_incoming
from src.quality_standards import materialize_item
from src.routers.quality_standards import (
    ParameterCreate,
    ParameterUpdate,
    ToleranceSave,
    create_parameter,
    read_scope,
    save_tolerances,
    update_parameter,
)

PLANT = str(uuid.uuid4())
OWNER = {"sub": "owner@example.com", "roles": ["Owner"]}
QC = {"sub": "qc@example.com", "roles": ["QC"]}


def _registry(db):
    """The client's paper checks, as seeded at start-up."""
    for key, label, unit, kind, sort in [("gsm", "GSM", "g/m²", "number", 10), ("moisture_pct", "Moisture", "%", "number", 20),
                                         ("bf", "BF", "", "number", 40), ("remark", "Remark", "", "text", 95)]:
        if not db.query(InventoryQualityTemplate).filter_by(plant_id="GLOBAL", material_type="RAW_PAPER", parameter_key=key).first():
            db.add(InventoryQualityTemplate(plant_id="GLOBAL", material_type="RAW_PAPER", parameter_key=key, label=label, unit=unit,
                                            input_type=kind, options=[], required=kind == "number", sort_order=sort, active="true"))
    db.commit()


def _readings(profile, **values):
    """A reading for every check on the profile (required checks must be recorded)."""
    def value(row):
        kind = row.get("input_type", "number")
        if kind == "number":
            return 1
        return next((option for option in row.get("options") or [] if option not in ("FAIL", "NO", "NOT_OK", "HOLD")), "ok")
    base = {row["code"]: value(row) for row in profile["parameters"]}
    return {**base, **values}


def _band(profile, code):
    return next(row for row in profile["parameters"] if row["code"] == code)


def test_bands_resolve_line_over_group_over_type_and_every_save_is_a_version():
    db = SessionLocal()
    try:
        _registry(db)
        code = f"STD-{uuid.uuid4().hex[:6].upper()}"
        group = f"Kraft-{uuid.uuid4().hex[:4]}"
        item = ItemMaster(item_code=code, name="Kraft 300", type="RAW_PAPER", tracking_mode="REEL", uom="KG", plant_id=PLANT, active="true")
        db.add(item); db.flush()
        materialize_item(db, item); db.commit()
        profile = item.quality_profile
        assert profile["status"] == "approved" and profile["source"] == "STANDARDS"
        # No band yet: measured checks are recorded only, so they can never hold a lot by themselves.
        assert _band(profile, "gsm")["record_only"] is True
        assert evaluate_incoming(profile=profile, readings=_readings(profile, gsm=999, moisture_pct=50, bf=1)).verdict == "OBSERVATION_ONLY"

        # Type default, group band (± % around the line nominal) and a line band.
        save_tolerances(ToleranceSave(material_type="RAW_PAPER", scope="TYPE", lines=[{"parameter_key": "moisture_pct", "mode": "RANGE", "min_value": 5, "max_value": 9}]), db, PLANT, OWNER)
        save_tolerances(ToleranceSave(material_type="RAW_PAPER", scope="GROUP", scope_key=group, lines=[{"parameter_key": "gsm", "mode": "PERCENT", "tolerance_value": 4}]), db, PLANT, OWNER)
        first = save_tolerances(ToleranceSave(material_type="RAW_PAPER", scope="ITEM", scope_key=code, material_group=group, nominals={"gsm": 300},
                                              lines=[{"parameter_key": "bf", "mode": "RANGE", "min_value": 18, "max_value": 22}], note="supplier spec"), db, PLANT, OWNER)
        assert first["version"] == 1
        db.expire_all()
        profile = db.get(ItemMaster, item.id).quality_profile
        assert (_band(profile, "gsm")["min"], _band(profile, "gsm")["max"]) == (288.0, 312.0)
        assert (_band(profile, "moisture_pct")["min"], _band(profile, "moisture_pct")["max"]) == (5.0, 9.0)
        assert (_band(profile, "bf")["min"], _band(profile, "bf")["max"]) == (18.0, 22.0)
        assert evaluate_incoming(profile=profile, readings=_readings(profile, gsm=305, moisture_pct=7, bf=20)).verdict in ("PASS", "OBSERVATION_ONLY")
        assert evaluate_incoming(profile=profile, readings=_readings(profile, gsm=320, moisture_pct=7, bf=20)).verdict == "FAIL"

        # The line overrides the group; the next save is version 2 and the old one stays in the audit.
        second = save_tolerances(ToleranceSave(material_type="RAW_PAPER", scope="ITEM", scope_key=code,
                                               lines=[{"parameter_key": "gsm", "mode": "RANGE", "min_value": 295, "max_value": 305}]), db, PLANT, OWNER)
        assert second["version"] == 2
        scope = read_scope("RAW_PAPER", "ITEM", code, "", "", db, PLANT, OWNER)
        assert scope["version"] == 2 and [v["version"] for v in scope["history"]] == [2, 1]
        assert scope["inherited"]["moisture_pct"]["from"] == "TYPE"
        db.expire_all()
        assert (_band(db.get(ItemMaster, item.id).quality_profile, "gsm")["min"]) == 295.0
        with pytest.raises(HTTPException) as inverted:
            save_tolerances(ToleranceSave(material_type="RAW_PAPER", scope="ITEM", scope_key=code, lines=[{"parameter_key": "gsm", "mode": "RANGE", "min_value": 310, "max_value": 300}]), db, PLANT, OWNER)
        assert inverted.value.status_code == 422
        db.rollback()
    finally:
        db.close()


def test_qc_owns_the_check_list_and_masters_cannot_band_an_unknown_check():
    db = SessionLocal()
    try:
        _registry(db)
        code = f"STD-{uuid.uuid4().hex[:6].upper()}"
        item = ItemMaster(item_code=code, name="Kraft 280", type="RAW_PAPER", tracking_mode="REEL", uom="KG", plant_id=PLANT, active="true")
        db.add(item); db.flush(); materialize_item(db, item); db.commit()
        label = f"Cobb {uuid.uuid4().hex[:4]}"
        added = create_parameter(ParameterCreate(material_type="RAW_PAPER", label=label, unit="g/m²"), db, QC)
        db.expire_all()
        assert any(row["code"] == added["parameter_key"] for row in db.get(ItemMaster, item.id).quality_profile["parameters"])
        with pytest.raises(HTTPException) as duplicate:
            create_parameter(ParameterCreate(material_type="RAW_PAPER", label=label), db, QC)
        assert duplicate.value.status_code == 409
        # Switching a check off removes it from every new inspection of the type.
        update_parameter(uuid.UUID(added["id"]), ParameterUpdate(active=False), db, QC)
        db.expire_all()
        assert not any(row["code"] == added["parameter_key"] for row in db.get(ItemMaster, item.id).quality_profile["parameters"])
        with pytest.raises(HTTPException) as unknown:
            save_tolerances(ToleranceSave(material_type="RAW_PAPER", scope="TYPE", lines=[{"parameter_key": added["parameter_key"], "mode": "RANGE", "min_value": 1}]), db, PLANT, OWNER)
        assert unknown.value.status_code == 422
        # Pass/fail outcomes are stored as tokens so NOT OK holds the lot.
        outcome = create_parameter(ParameterCreate(material_type="RAW_PAPER", label=f"Core {uuid.uuid4().hex[:4]}", input_type="select", options=["OK", "Not ok"]), db, QC)
        assert outcome["options"] == ["OK", "NOT_OK"]
        update_parameter(uuid.UUID(outcome["id"]), ParameterUpdate(active=False), db, QC)
    finally:
        db.close()
