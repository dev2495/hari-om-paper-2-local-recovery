"""Verification issue #12 (1 Nov 2026): a plant added after masterdata started gets the standard reason codes the
first time one of its reason lists is read or checked, not only at the next restart."""
import os
import uuid

import pytest

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401,E402  create_all + start-up seed
from src import models, reason_seed  # noqa: E402
from src.database import SessionLocal  # noqa: E402
from src.reason_catalog import CATEGORIES  # noqa: E402
from src.routers import shop_floor  # noqa: E402

EXPECTED = sum(len(row["seeds"]) for row in CATEGORIES)


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _codes(db, plant):
    return db.query(models.ReasonCode).filter(models.ReasonCode.plant_id == plant).count()


def test_new_plant_is_seeded_on_first_read_and_never_twice(db):
    plant = f"PLANT-NEW-{uuid.uuid4().hex[:8]}"
    assert _codes(db, plant) == 0
    rows = shop_floor.list_reasons(category=None, include_inactive=False, db=db, plant_scope={"selected_plant_id": plant, "scope_all": False, "allowed_plants": [plant]})
    assert len(rows) == EXPECTED and _codes(db, plant) == EXPECTED
    # The plant then edits its own list: a later first use (new process) never puts a code back.
    db.query(models.ReasonCode).filter(models.ReasonCode.plant_id == plant, models.ReasonCode.code == "SS-OTHER").delete()
    db.commit()
    reason_seed._checked.clear()
    assert reason_seed.ensure_plant_reason_codes(plant) == 0
    assert _codes(db, plant) == EXPECTED - 1


def test_new_plant_is_seeded_when_a_service_first_validates_a_code(db):
    plant = f"PLANT-NEW-{uuid.uuid4().hex[:8]}"
    payload = shop_floor.ReasonValidate(category="STAGE_SHORT_CLOSE", reason_code="SS-MATERIAL-SHORT", plant_id=plant)
    result = shop_floor.validate_reason_choice(payload, db=db, plant_scope={"selected_plant_id": plant, "scope_all": False, "allowed_plants": [plant]},
                                               current_user={"sub": "svc", "roles": ["Owner"]})
    assert result["code"] == "SS-MATERIAL-SHORT"
