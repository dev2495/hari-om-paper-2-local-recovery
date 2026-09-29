"""Draft stock count sheets stay complete and current without losing counts (isolated PostgreSQL)."""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Isolated procurement database required", allow_module_level=True)

import src.main  # noqa: F401  schema + startup DDL
from src.database import SessionLocal
from src.models import ItemMaster, ItemType, TrackingMode, UOM
from src.routers import stock_control as sc

USER = {"sub": "store@test", "roles": ["Store"], "token": ""}


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _item(db, plant, code):
    item = ItemMaster(item_code=code, name=code, type=ItemType.PACKAGING, tracking_mode=TrackingMode.BULK, uom=UOM.PCS, plant_id=plant, active="true")
    db.add(item)
    db.commit()
    return item


def _draft(db, plant):
    payload = sc.CertificationCreatePayload(period_start=date(2026, 9, 1), period_end=date(2026, 9, 30))
    return sc.create_certification(payload, db=db, plant_id=plant, current_user=USER)


def test_refresh_adds_new_items_and_keeps_counts(db):
    plant = f"P-{uuid.uuid4().hex[:8]}"
    first = _item(db, plant, "BOX-A")
    cert = _draft(db, plant)
    assert [line["item_code"] for line in cert["lines"]] == ["BOX-A"]
    line_id = cert["lines"][0]["id"]
    sc.update_certification(uuid.UUID(cert["id"]), sc.CertificationUpdatePayload(lines=[sc.CertificationLineUpdatePayload(line_id=uuid.UUID(line_id), physical_qty=7)]), db=db, plant_id=plant, current_user=USER)
    _item(db, plant, "BOX-B")  # created after the count sheet was drafted
    detail = sc.get_certification(uuid.UUID(cert["id"]), db=db, plant_scope={"scope_all": False, "selected_plant_id": plant}, current_user=USER)
    assert detail["missing_item_count"] == 1
    refreshed = sc.refresh_certification(uuid.UUID(cert["id"]), db=db, plant_id=plant, current_user=USER)
    by_code = {line["item_code"]: line for line in refreshed["lines"]}
    assert set(by_code) == {"BOX-A", "BOX-B"} and refreshed["refresh"]["added"] == 1
    assert by_code["BOX-A"]["physical_qty"] == 7 and by_code["BOX-A"]["count_state"] == "COUNTED"
    assert by_code["BOX-A"]["variance_qty"] == 7
    # Drafting the same period again keeps the count too.
    again = _draft(db, plant)
    assert {line["item_code"]: line["physical_qty"] for line in again["lines"]}["BOX-A"] == 7
    assert first.id


def test_certify_needs_every_line_counted(db):
    plant = f"P-{uuid.uuid4().hex[:8]}"
    _item(db, plant, "BOX-C")
    _item(db, plant, "BOX-D")
    cert = _draft(db, plant)
    cid = uuid.UUID(cert["id"])
    with pytest.raises(HTTPException) as error:
        sc.certify_stock(cid, sc.CertificationActionPayload(), db=db, plant_id=plant, current_user=USER)
    assert error.value.status_code == 409 and "2 line(s) are not counted" in error.value.detail
    db.rollback()
    sc.update_certification(cid, sc.CertificationUpdatePayload(lines=[sc.CertificationLineUpdatePayload(line_id=uuid.UUID(line["id"]), physical_qty=0) for line in cert["lines"]]), db=db, plant_id=plant, current_user=USER)
    certified = sc.certify_stock(cid, sc.CertificationActionPayload(), db=db, plant_id=plant, current_user=USER)
    assert certified["status"] == "CERTIFIED"
