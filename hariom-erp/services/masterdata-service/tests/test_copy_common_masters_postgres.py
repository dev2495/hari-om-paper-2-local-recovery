"""Copy common masters into a new plant (owner decision 3 Nov 2026): materials, customers, suppliers and
the tool list are copied from an existing plant; plant-specific masters are not; a second run copies 0."""
import os
import uuid

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401,E402  create_all + start-up seed
from src import models  # noqa: E402
from src.database import SessionLocal  # noqa: E402
from src.routers import common_masters  # noqa: E402

OWNER = {"sub": "owner@hariom.com", "roles": ["Owner"], "allowed_plants": []}


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def plants(db, monkeypatch):
    """Two fresh plants: the source has one of each common master (plus inactive rows and plant-only masters)."""
    src, dst = f"PLANT-SRC-{uuid.uuid4().hex[:6]}", f"PLANT-NEW-{uuid.uuid4().hex[:6]}"
    monkeypatch.setattr(common_masters, "_active_plants", lambda token: [{"id": src, "code": src}, {"id": dst, "code": dst}])
    monkeypatch.setattr(common_masters, "emit_audit_event", lambda **kwargs: True)
    db.add(models.PaperMaster(code="351", variety="Kraft", gsm=350, strength_type="BF", strength_value=20, plant_id=src))
    db.add(models.PaperMaster(code="OLD-1", variety="Kraft", gsm=300, strength_type="BF", strength_value=18, plant_id=src, active=False))
    db.add(models.AdhesiveMaster(name="PVA", internal_code="20100", viscosity=1800, plant_id=src))
    vendor = models.ParchmentVendor(id=uuid.uuid4(), name="Ahlstrom", plant_id=src)
    db.add(vendor)
    db.flush()
    db.add(models.ParchmentColor(vendor_id=vendor.id, color_name="Red", plant_id=src))
    db.add(models.PackagingBox(code="R-150", length_mm=400, width_mm=300, height_mm=300, size_label="400x300", plant_id=src))
    db.add(models.PackagingPlasticSheet(sku="PS-1", size_label="1 m", plant_id=src))
    db.add(models.PackagingFadda(sku="FD-3", plant_id=src))
    customer = models.Customer(id=uuid.uuid4(), customer_code="C001", name="Acme Yarns", gst_no="24ABCDE1234F1Z5", plant_id=src)
    db.add(customer)
    db.flush()
    db.add(models.CustomerContact(customer_id=customer.id, department="Purchase", contact_name="Ravi", plant_id=src))
    supplier = models.Supplier(id=uuid.uuid4(), supplier_code="S001", name="Mill One", gst_no="24AAAAA1111A1Z5", plant_id=src)
    db.add(supplier)
    db.flush()
    db.add(models.SupplierContact(supplier_id=supplier.id, contact_name="Mehul", plant_id=src))
    db.add(models.ToolMaster(category="NOTCH", name="N-55", department="WINDER", attribute_values={"degree": "55"}, usage_count=9, plant_id=src))
    db.add(models.ToolMaster(category="BLADE", name="B-OLD", department="WINDER", status="DISCONTINUED", plant_id=src))
    db.add(models.ToolAttributeOption(category="NOTCH", field_key="degree", value="55", plant_id=src))
    # Plant-specific masters stay with their plant.
    db.add(models.Machine(code="W1", name="Winder 1", department="WINDER", plant_id=src))
    db.add(models.Mandrel(mandrel_code="M-76", outer_diameter_mm=76, length_mm=1000, plant_id=src))
    db.add(models.Employee(employee_code="E1", name="Operator One", plant_id=src))
    db.commit()
    return src, dst


def _run(db, src, dst, dry_run, user=OWNER):
    payload = common_masters.CopyCommonRequest(source_plant_id=src, target_plant_id=dst, dry_run=dry_run)
    return common_masters.copy_common_masters(payload, db=db, current_user=user, token="t")


def _counts(result):
    return {row["key"]: row["to_copy"] for row in result["types"]}


def _count(db, model, plant):
    return db.query(model).filter(model.plant_id == plant).count()


EXPECTED = {"papers": 1, "adhesives": 1, "parchment_companies": 1, "parchment_colours": 1, "boxes": 1,
            "plastic_sheets": 1, "fadda": 1, "customers": 1, "suppliers": 1, "tools": 1, "tool_options": 1}


def test_dry_run_counts_and_writes_nothing(db, plants):
    src, dst = plants
    result = _run(db, src, dst, dry_run=True)
    assert _counts(result) == EXPECTED and result["total_to_copy"] == 11
    assert next(row for row in result["types"] if row["key"] == "customers")["contacts"] == 1
    db.expire_all()
    for spec in common_masters.COMMON_TYPES:
        assert _count(db, spec["model"], dst) == 0


def test_copy_creates_common_rows_then_second_run_copies_nothing(db, plants):
    src, dst = plants
    result = _run(db, src, dst, dry_run=False)
    assert _counts(result) == EXPECTED and result["copied"] == 11
    db.expire_all()
    paper = db.query(models.PaperMaster).filter(models.PaperMaster.plant_id == dst).one()
    assert paper.code == "351" and paper.gsm == 350
    customer = db.query(models.Customer).filter(models.Customer.plant_id == dst).one()
    assert customer.gst_no == "24ABCDE1234F1Z5" and [c.contact_name for c in customer.contacts] == ["Ravi"]
    assert customer.contacts[0].plant_id == dst
    supplier = db.query(models.Supplier).filter(models.Supplier.plant_id == dst).one()
    assert supplier.gst_no == "24AAAAA1111A1Z5" and [c.contact_name for c in supplier.contacts] == ["Mehul"]
    colour = db.query(models.ParchmentColor).filter(models.ParchmentColor.plant_id == dst).one()
    assert colour.vendor.plant_id == dst and colour.vendor.name == "Ahlstrom"
    tool = db.query(models.ToolMaster).filter(models.ToolMaster.plant_id == dst).one()
    assert tool.name == "N-55" and tool.attribute_values == {"degree": "55"} and tool.usage_count == 0
    # Inactive rows are not copied.
    assert db.query(models.PaperMaster).filter(models.PaperMaster.plant_id == dst, models.PaperMaster.code == "OLD-1").count() == 0

    again = _run(db, src, dst, dry_run=False)
    assert again["copied"] == 0
    assert all(row["already_there"] >= 1 for row in again["types"])
    db.expire_all()
    assert _count(db, models.Customer, dst) == 1 and _count(db, models.CustomerContact, dst) == 1


def test_existing_target_row_is_skipped_not_overwritten(db, plants):
    src, dst = plants
    db.add(models.Customer(customer_code="C001", name="Acme Yarns (new plant)", plant_id=dst))
    db.commit()
    result = _run(db, src, dst, dry_run=False)
    row = next(item for item in result["types"] if item["key"] == "customers")
    assert row["to_copy"] == 0 and row["already_there"] == 1
    db.expire_all()
    assert db.query(models.Customer).filter(models.Customer.plant_id == dst).one().name == "Acme Yarns (new plant)"


def test_plant_specific_masters_are_untouched(db, plants):
    src, dst = plants
    _run(db, src, dst, dry_run=False)
    db.expire_all()
    for model in (models.Machine, models.Mandrel, models.Employee, models.TubeSize, models.ShiftDefinition, models.ReasonCode):
        assert _count(db, model, dst) == 0
    assert _count(db, models.Machine, src) == 1


def test_non_owner_is_refused(db, plants):
    src, dst = plants
    manager = {"sub": "pm@hariom.com", "roles": ["PlantManager"], "allowed_plants": [src, dst]}
    with pytest.raises(HTTPException) as error:
        _run(db, src, dst, dry_run=True, user=manager)
    assert error.value.status_code == 403


def test_plant_outside_allowed_is_refused(db, plants):
    src, dst = plants
    owner_one_plant = {"sub": "admin@hariom.com", "roles": ["Admin"], "allowed_plants": [src]}
    with pytest.raises(HTTPException) as error:
        _run(db, src, dst, dry_run=False, user=owner_one_plant)
    assert error.value.status_code == 403
    db.expire_all()
    assert _count(db, models.PaperMaster, dst) == 0


def test_same_plant_and_unknown_target_are_refused(db, plants):
    src, dst = plants
    with pytest.raises(HTTPException) as error:
        _run(db, src, src, dry_run=True)
    assert error.value.status_code == 400
    # Plant A by code and by id are the same plant.
    with pytest.raises(HTTPException) as error:
        _run(db, "PLANT_A", "00000000-0000-0000-0000-0000000000a1", dry_run=True)
    assert error.value.status_code == 400
    with pytest.raises(HTTPException) as error:
        _run(db, src, f"PLANT-GONE-{uuid.uuid4().hex[:6]}", dry_run=True)
    assert error.value.status_code == 404
